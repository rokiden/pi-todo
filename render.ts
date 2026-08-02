/**
 * TUI rendering for the todo extension — widget and tool result components
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, Text, type Component, type TUI } from "@earendil-works/pi-tui";
import type { TodoItem, TodoStatus } from "./store.ts";

type Theme = ExtensionContext["ui"]["theme"];

/**
 * BorderedBox — a container that draws a Unicode box border around its children.
 * The border color is controlled by the `colorFn` argument (e.g. theme.fg("success", ...)).
 */
class BorderedBox implements Component {
	private children: Component[] = [];
	private colorFn: (text: string) => string;
	private cachedLines: string[] | null = null;
	private cachedWidth: number | null = null;

	constructor(colorFn: (text: string) => string) {
		this.colorFn = colorFn;
	}

	addChild(component: Component): void {
		this.children.push(component);
		this.invalidate();
	}

	invalidate(): void {
		this.cachedLines = null;
		this.cachedWidth = null;
		for (const child of this.children) {
			child.invalidate?.();
		}
	}

	render(width: number): string[] {
		// Cache hit
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}

		// Inner width: total - 2 (left/right border chars)
		const innerWidth = Math.max(0, width - 2);

		// Render all children into flat line array
		const innerLines: string[] = [];
		for (const child of this.children) {
			const rendered = child.render(innerWidth);
			for (const line of rendered) {
				innerLines.push(line);
			}
		}

		const c = this.colorFn;
		const topLeft = c("┌");
		const topRight = c("┐");
		const bottomLeft = c("└");
		const bottomRight = c("┘");
		const horizontal = c("─");
		const vertical = c("│");

		const lines: string[] = [];

		// Top border
		lines.push(`${topLeft}${horizontal.repeat(innerWidth)}${topRight}`);

		// Middle rows
		for (const inner of innerLines) {
			lines.push(`${vertical}${inner}${vertical}`);
		}

		// Bottom border
		lines.push(`${bottomLeft}${horizontal.repeat(innerWidth)}${bottomRight}`);

		this.cachedLines = lines;
		this.cachedWidth = width;
		return lines;
	}
}

const STATUS_ICON: Record<TodoStatus, string> = {
	pending: "[ ]",
	done: "[x]",
};



/** Truncate text to fit within maxWidth (visible characters) */
function truncate(text: string, maxWidth: number): string {
	if (text.length <= maxWidth) return text;
	return text.slice(0, maxWidth - 1) + "…";
}

/** Build the widget content lines for the todo list */
export function buildWidgetLines(items: TodoItem[], theme: Theme, width: number): string[] {
	if (items.length === 0) return [];

	const lines: string[] = [];
	const pending = items.filter((i) => i.status === "pending").length;
	const done = items.filter((i) => i.status === "done").length;
	// One header line: "TODO · N tasks · P pending · D done" (zero counters omitted)
	const counters: string[] = [`${items.length} task${items.length === 1 ? "" : "s"}`];
	if (pending > 0) counters.push(`${pending} pending`);
	if (done > 0) counters.push(`${done} done`);
	const header = `${theme.fg("accent", theme.bold("TODO"))} ${theme.fg("dim", `· ${counters.join(" · ")}`)}`;
	lines.push(truncate(header, width));

	// No height limit — render every item
	for (const item of items) {
		const icon = STATUS_ICON[item.status];
		const text = truncate(item.text, width - 24);
		lines.push(
			truncate(`  ${icon} ${theme.fg("dim", `[${item.id}]`)} ${text}`, width),
		);
	}

	return lines;
}

/** Create the widget component factory for setWidget() */
export function createWidgetComponent(items: TodoItem[]): (tui: unknown, theme: Theme) => Component {
	return (_tui: unknown, theme: Theme) => {
		const width = process.stdout.columns || 120;
		const lines = buildWidgetLines(items, theme, width);
		const box = new BorderedBox((text: string) => theme.fg("success", text));
		for (const line of lines) {
			box.addChild(new Text(line, 1, 0));
		}
		return box;
	};
}

/** Create the collapsed single-line widget (no border, full width):
 *  " ──── TODO · 2 tasks · 1 pending · 1 done ──────────────── " */
export function createCollapsedWidgetComponent(items: TodoItem[]): (tui: unknown, theme: Theme) => Component {
	return (_tui: unknown, theme: Theme) => {
		const width = process.stdout.columns || 120;
		const pending = items.filter((i) => i.status === "pending").length;
		const done = items.filter((i) => i.status === "done").length;
		const summary = `${items.length} task${items.length === 1 ? "" : "s"} · ${pending} pending · ${done} done`;
		// Keep the summary within the terminal width (" ──── TODO · " + "  " = 15 chars)
		const summaryMax = Math.max(0, width - 15);
		const shown =
			summary.length > summaryMax && summaryMax > 0
				? summary.slice(0, summaryMax - 1) + "…"
				: summary;
		// Fill with dashes, keeping a single trailing space to mirror the left gap
		const filler = "─".repeat(Math.max(0, width - 15 - shown.length));
		// Only the line decoration uses the border color; TODO/counters match the full widget
		const line =
			`${theme.fg("success", " ──── ")}` +
			`${theme.fg("accent", theme.bold("TODO"))}` +
			`${theme.fg("dim", ` · ${shown} `)}` +
			`${theme.fg("success", `${filler} `)}`;
		return new Text(line, 0, 0);
	};
}

/** Render the tool result as a text summary */
export function renderTodoResult(items: TodoItem[], theme: Theme, width: number): Component {
	const container = new Container();
	container.addChild(new Text("", 0, 0));

	if (items.length === 0) {
		container.addChild(new Text(theme.fg("dim", "  No todo items found."), 0, 0));
		return container;
	}

	for (const item of items) {
		const icon = STATUS_ICON[item.status];
		const text = truncate(item.text, width - 28);
		container.addChild(
			new Text(`  ${icon} ${theme.bold(item.id)} ${text}`, 0, 0),
		);
	}

	return container;
}
