/**
 * pi-todo — Persistent per-project todo tracker with live TUI widget
 *
 * Registers a `todo` tool the LLM can call to manage a task list stored in
 * `.pi/todo.json` in the project root. A live widget above the editor shows
 * the current state at all times. Supports CLI-style `/todo` slash commands
 * and an `Alt+T` hotkey for toggling widget visibility.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { type ExtensionAPI, type ExtensionContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text, type Component, type AutocompleteItem } from "@earendil-works/pi-tui";
import { TodoParams } from "./schemas.ts";
import {
	addItem,
	clearCompleted,
	listItems,
	readStore,
	removeItem,
	reorderItem,
	toggleItem,
	updateItem,
	type TodoItem,
	type TodoStatus,
} from "./store.ts";
import { buildWidgetLines, createWidgetComponent, renderTodoResult } from "./render.ts";

const WIDGET_KEY = "todo";
let widgetVisible = true;
/** Update the live widget from the current store state */
function refreshWidget(pi: ExtensionAPI, cwd: string): void {
	const ctx = lastCtx;
	if (!ctx || !ctx.hasUI) return;
	const store = readStore(cwd);
	if (store.items.length === 0) {
		ctx.ui.setWidget(WIDGET_KEY, undefined);
		return;
	}
	if (widgetVisible) {
		ctx.ui.setWidget(WIDGET_KEY, createWidgetComponent(store.items));
	}
}

// Track the last known UI context for widget updates
let lastCtx: ExtensionContext | null = null;
/** Capture a context for widget refresh. A non-UI context (e.g. a subagent
 *  session) must never clobber the main session's UI context, so only adopt
 *  contexts that actually carry UI. */
function captureCtx(ctx: ExtensionContext): void {
	if (ctx.hasUI) lastCtx = ctx;
}

// --- Cross-session file watch -------------------------------------------
// Subagents share the same extension module instance as the main session.
// When a subagent calls the todo tool it writes .pi/todo.json correctly but
// its non-UI context can clobber lastCtx; captureCtx() above guards against
// that. Watch the .pi directory so any external write — subagent, another
// session, manual edit — always refreshes the widget in the UI session.
let watcher: fs.FSWatcher | null = null;
let watchedCwd: string | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRefresh(pi: ExtensionAPI, cwd: string): void {
	if (refreshTimer) clearTimeout(refreshTimer);
	refreshTimer = setTimeout(() => {
		refreshTimer = null;
		refreshWidget(pi, cwd);
	}, 50);
}

function stopWatching(): void {
	watcher?.close();
	watcher = null;
	watchedCwd = null;
	if (refreshTimer) {
		clearTimeout(refreshTimer);
		refreshTimer = null;
	}
}

function startWatching(pi: ExtensionAPI, cwd: string): void {
	if (watchedCwd === cwd && watcher) return;
	stopWatching();
	const piDir = path.join(cwd, ".pi");
	try {
		if (!fs.existsSync(piDir)) {
			// .pi/ doesn't exist yet — watch cwd until it appears, then re-target.
			watcher = fs.watch(cwd, (_event, filename) => {
				if (filename === ".pi") startWatching(pi, cwd);
			});
		} else {
			watcher = fs.watch(piDir, (_event, filename) => {
				if (filename === "todo.json") scheduleRefresh(pi, cwd);
			});
		}
		watchedCwd = cwd;
	} catch {
		// fs.watch can fail on some filesystems (network mounts, watch-limit
		// exhaustion). Fall back to polling the file directly.
		fs.watchFile(path.join(piDir, "todo.json"), { interval: 1000 }, () => scheduleRefresh(pi, cwd));
		watchedCwd = cwd;
	}
}

interface TodoDetails {
	action: string;
	items: TodoItem[];
	item?: TodoItem;
	removed?: number;
	moved?: boolean;
	error?: string;
}

export default function registerTodoExtension(pi: ExtensionAPI): void {
	const tool: ToolDefinition<typeof TodoParams, TodoDetails> = {
		name: "todo",
		label: "Todo",
		description: `Manage a persistent per-project todo list stored in .pi/todo.json. The list survives across sessions and is shown as a live widget above the editor.

Actions:
- add: Create a new todo item (requires text)
- update: Modify an existing item by ID (requires id, optional: text, status)
- toggle: Cycle status pending → in-progress → done (requires id)
- remove: Delete single task by ID (requires id)
- list: List all items (optional: filter by status)
- clear: Clears completed items only
- reorder: Move an item up or down in the list (requires id, direction)

Only the main agent can modify the todo list. Subagents cannot call this tool.`,
		parameters: TodoParams,
		promptSnippet: "Manage a persistent todo list with add, update, toggle, remove, list, clear, and reorder actions.",
		promptGuidelines: [
			"Use the todo tool to track multi-step tasks — add items before starting work, toggle to in-progress when beginning, toggle to done when complete.",
		],

		async execute(toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<TodoDetails>> {
			captureCtx(ctx);
			const cwd = ctx.cwd;

			try {
				switch (params.action) {
					case "add": {
						if (!params.text) {
							return {
								content: [{ type: "text", text: "Error: 'text' is required for add action." }],
								isError: true,
								details: { action: "add", items: [], error: "text is required" },
							};
						}
						const item = addItem(cwd, params.text);
						refreshWidget(pi, cwd);
						const all = listItems(cwd);
						return {
							content: [{ type: "text", text: `Added: ${item.id} — ${item.text}` }],
							details: { action: "add", items: all, item },
						};
					}

					case "update": {
						if (!params.id) {
							return {
								content: [{ type: "text", text: "Error: 'id' is required for update action." }],
								isError: true,
								details: { action: "update", items: [], error: "id is required" },
							};
						}
						const updated = updateItem(cwd, params.id, {
							text: params.text,
							status: params.status as TodoStatus | undefined,
						});
						if (!updated) {
							return {
								content: [{ type: "text", text: `Error: Item ${params.id} not found.` }],
								isError: true,
								details: { action: "update", items: [], error: "item not found" },
							};
						}
						refreshWidget(pi, cwd);
						const all = listItems(cwd);
						return {
							content: [{ type: "text", text: `Updated: ${updated.id} — ${updated.text} [${updated.status}]` }],
							details: { action: "update", items: all, item: updated },
						};
					}

					case "toggle": {
						if (!params.id) {
							return {
								content: [{ type: "text", text: "Error: 'id' is required for toggle action." }],
								isError: true,
								details: { action: "toggle", items: [], error: "id is required" },
							};
						}
						const toggled = toggleItem(cwd, params.id);
						if (!toggled) {
							return {
								content: [{ type: "text", text: `Error: Item ${params.id} not found.` }],
								isError: true,
								details: { action: "toggle", items: [], error: "item not found" },
							};
						}
						refreshWidget(pi, cwd);
						const all = listItems(cwd);
						return {
							content: [{ type: "text", text: `Toggled: ${toggled.id} — ${toggled.text} → ${toggled.status}` }],
							details: { action: "toggle", items: all, item: toggled },
						};
					}

					case "remove": {
						if (!params.id) {
							return {
								content: [{ type: "text", text: "Error: 'id' is required for remove action." }],
								isError: true,
								details: { action: "remove", items: [], error: "id is required" },
							};
						}
						const removed = removeItem(cwd, params.id);
						if (!removed) {
							return {
								content: [{ type: "text", text: `Error: Item ${params.id} not found.` }],
								isError: true,
								details: { action: "remove", items: [], error: "item not found" },
							};
						}
						refreshWidget(pi, cwd);
						const all = listItems(cwd);
						return {
							content: [{ type: "text", text: `Removed: ${params.id}` }],
							details: { action: "remove", items: all },
						};
					}

					case "list": {
						const items = listItems(cwd, params.filter);
						return {
							content: [{ type: "text", text: formatListText(items) }],
							details: { action: "list", items },
						};
					}

					case "reorder": {
						if (!params.id) {
							return {
								content: [{ type: "text", text: "Error: 'id' is required for reorder action." }],
								isError: true,
								details: { action: "reorder", items: [], error: "id is required" },
							};
						}
						if (!params.direction) {
							return {
								content: [{ type: "text", text: "Error: 'direction' is required for reorder action." }],
								isError: true,
								details: { action: "reorder", items: [], error: "direction is required" },
							};
						}
						const moved = reorderItem(cwd, params.id, params.direction as "up" | "down");
						if (!moved) {
							return {
								content: [{ type: "text", text: `Error: Could not reorder ${params.id} (not found or already at ${params.direction === "up" ? "top" : "bottom"}).` }],
								isError: true,
								details: { action: "reorder", items: [], error: "cannot reorder" },
							};
						}
						refreshWidget(pi, cwd);
						const all = listItems(cwd);
						return {
							content: [{ type: "text", text: `Reordered: ${params.id} ${params.direction}` }],
							details: { action: "reorder", items: all, moved: true },
						};
					}

					case "clear": {
						const count = clearCompleted(cwd);
						refreshWidget(pi, cwd);
						const all = listItems(cwd);
						return {
							content: [{ type: "text", text: `Cleared ${count} completed item${count === 1 ? "" : "s"}.` }],
							details: { action: "clear", items: all, removed: count },
						};
					}

					default:
						return {
							content: [{ type: "text", text: `Error: Unknown action '${params.action}'.` }],
							isError: true,
							details: { action: String(params.action), items: [], error: "unknown action" },
						};
				}
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Error: ${msg}` }],
					isError: true,
					details: { action: String(params.action), items: [], error: msg },
				};
			}
		},

		renderCall(args, theme) {
			const action = args.action || "?";
			if (action === "list") {
				return new Text(`${theme.fg("toolTitle", theme.bold("todo "))}list${args.filter ? ` ${theme.fg("dim", args.filter)}` : ""}`, 0, 0);
			}
			if (action === "add" && args.text) {
				const preview = args.text.length > 50 ? `${args.text.slice(0, 49)}…` : args.text;
				return new Text(`${theme.fg("toolTitle", theme.bold("todo "))}add ${theme.fg("accent", `"${preview}"`)}`, 0, 0);
			}
			const target = args.id || "";
			return new Text(`${theme.fg("toolTitle", theme.bold("todo "))}${action}${target ? ` ${theme.fg("accent", target)}` : ""}`, 0, 0);
		},

		renderResult(result, options, theme, _context) {
			const details = result.details as TodoDetails | undefined;
			if (!details) {
				const text = typeof result.content === "string"
					? result.content
					: result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
				return new Text(text, 0, 0);
			}
			if (result.isError) {
				const text = typeof result.content === "string"
					? result.content
					: result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
				return new Text(theme.fg("error", text), 0, 0);
			}
			const width = process.stdout.columns || 120;
			return renderTodoResult(details.items, theme, width);
		},
	};

	pi.registerTool(tool);

	// Slash command with CLI-style arg parsing: /todo add Build login page
	// Supports: /todo add <text>, /todo toggle <id>, /todo remove <id|*>,
	//           /todo list, /todo clear
	pi.registerCommand("todo", {
		description: "CLI-style todo manager — /todo add <text>, /todo toggle <id>, /todo remove <id|*>, /todo list, /todo clear",
		getArgumentCompletions(prefix) {
			const actions = [
				{ value: "add", label: "add", description: "/todo add <text> — create a new task" },
				{ value: "update", label: "update", description: "/todo update <id> [--status=<pending|in-progress|done>] [--text=<text>] — change task fields by ID" },
				{ value: "toggle", label: "toggle", description: "/todo toggle <id> — cycle status (pending → in-progress → done → pending)" },
				{ value: "remove", label: "remove", description: "/todo remove <id|*> — delete a specific task or * to clear all" },
				{ value: "list", label: "list", description: "/todo list [status] — show tasks, optionally filter by status" },
				{ value: "clear", label: "clear", description: "/todo clear — remove all completed (done) tasks" },
				{ value: "reorder", label: "reorder", description: "/todo reorder <id> <up|down> — move a task in the list order" },
			];
			const filtered = actions.filter((a) => a.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		async handler(args, ctx) {
			captureCtx(ctx);
			const cwd = ctx.cwd;
			const trimmed = args.trim();

			// Parse action from first word
			const parts = trimmed.split(/\s+/);
			const action = parts[0]?.toLowerCase();
			const rest = parts.slice(1).join(" ");

			switch (action) {
				case "add": {
					if (!rest) {
						ctx.ui.notify("Usage: /todo add <text>", "error");
						return;
					}
					const item = addItem(cwd, rest);
					refreshWidget(pi, cwd);
					ctx.ui.notify(`Added: ${item.id} — ${item.text}`, "info");
					break;
				}

				case "toggle": {
					if (!rest) {
						ctx.ui.notify("Usage: /todo toggle <id>", "error");
						return;
					}
					const toggled = toggleItem(cwd, rest);
					if (!toggled) {
						ctx.ui.notify(`Error: Item ${rest} not found.`, "error");
						return;
					}
					refreshWidget(pi, cwd);
					ctx.ui.notify(`Toggled: ${toggled.id} — ${toggled.text} → ${toggled.status}`, "info");
					break;
				}

				case "remove": {
					if (!rest) {
						ctx.ui.notify("Usage: /todo remove <id> or /todo remove *", "error");
						return;
					}
					if (rest === "*") {
						// Remove all tasks at once
						const store = readStore(cwd);
						if (store.items.length === 0) {
							ctx.ui.notify("No tasks to remove.", "info");
							return;
						}
						const count = store.items.length;
						fs.writeFileSync(
							`${cwd}/.pi/todo.json`,
							JSON.stringify({ items: [], counter: 0 }, null, "\t") + "\n",
							"utf-8",
						);
						refreshWidget(pi, cwd);
						ctx.ui.notify(`Removed all ${count} task${count === 1 ? "" : "s"}.`, "info");
						return;
					}
					const removed = removeItem(cwd, rest);
					if (!removed) {
						ctx.ui.notify(`Error: Item ${rest} not found.`, "error");
						return;
					}
					refreshWidget(pi, cwd);
					ctx.ui.notify(`Removed: ${rest}`, "info");
					break;
				}

				case "list": {
					const items = listItems(cwd);
					if (items.length === 0) {
						ctx.ui.notify("No todo items.", "info");
						return;
					}
					ctx.ui.notify(formatListText(items), "info");
					break;
				}

				case "reorder": {
					if (!rest) {
						ctx.ui.notify("Usage: /todo reorder <id> <direction>", "error");
						return;
					}
					const parts = rest.split(/\s+/);
					const id = parts[0];
					const direction = parts[1] as "up" | "down" | undefined;
					if (!id) {
						ctx.ui.notify("Usage: /todo reorder <id> <direction>", "error");
						return;
					}
					if (!direction || (direction !== "up" && direction !== "down")) {
						ctx.ui.notify("Usage: /todo reorder <id> <direction>", "error");
						return;
					}
					const moved = reorderItem(cwd, id, direction);
					if (!moved) {
						ctx.ui.notify(`Error: Could not reorder ${id} (not found or already at ${direction === "up" ? "top" : "bottom"}).`, "error");
						return;
					}
					refreshWidget(pi, cwd);
					ctx.ui.notify(`Reordered: ${id} ${direction}`, "info");
					break;
				}

				case "clear": {
					const count = clearCompleted(cwd);
					refreshWidget(pi, cwd);
					ctx.ui.notify(`Cleared ${count} completed item${count === 1 ? "" : "s"}.`, "info");
					break;
				}

				default:
					// No action specified — show current list
					const items = listItems(cwd);
					if (items.length === 0) {
						ctx.ui.notify("No todo items.", "info");
						return;
					}
					ctx.ui.notify(formatListText(items), "info");
					break;
			}
		},
	});

	// Alt+T hotkey — toggles widget visibility
	pi.registerShortcut("alt+t", {
		description: "Toggle todo widget visibility",
		handler: async (ctx) => {
			widgetVisible = !widgetVisible;
			if (!widgetVisible) {
				ctx.ui.setWidget(WIDGET_KEY, undefined);
			} else {
				const store = readStore(ctx.cwd);
				if (store.items.length > 0) {
					ctx.ui.setWidget(WIDGET_KEY, createWidgetComponent(store.items));
				}
			}
			ctx.ui.notify(
				widgetVisible
					? "Todo widget shown"
					: "Todo widget hidden",
				"info",
			);
		},
	});

	// Session start: load existing todos and render widget
	pi.on("session_start", (_event, ctx) => {
		captureCtx(ctx);
		const cwd = ctx.cwd;
		// Only the UI-bearing session needs to watch for external writes.
		// Non-UI contexts (subagent sessions) share this same module instance,
		// so they must not clobber lastCtx — captureCtx() above handles that.
		if (ctx.hasUI) {
			startWatching(pi, cwd);
		}
		const todoPath = `${cwd}/.pi/todo.json`;
		if (!fs.existsSync(todoPath)) return;
		const store = readStore(cwd);
		if (store.items.length === 0) return;
		if (ctx.hasUI && widgetVisible) {
			ctx.ui.setWidget(WIDGET_KEY, createWidgetComponent(store.items));
		}
	});

	// Session shutdown: clear widget
	pi.on("session_shutdown", (_event, ctx) => {
		widgetVisible = true; // Reset for next session
		stopWatching();
		if (ctx.hasUI) {
			ctx.ui.setWidget(WIDGET_KEY, undefined);
		}
	});
}

/** Format items as a plain text list for slash command output */
function formatListText(items: TodoItem[]): string {
	if (items.length === 0) return "No todo items.";
	const lines: string[] = [];
	for (const item of items) {
		const icon = item.status === "done" ? "[x]" : item.status === "in-progress" ? "[•]" : "[ ]";
		lines.push(`${icon} ${item.id} ${item.text}`);
	}
	return lines.join("\n");
}
