# pi-todo

A lightweight [Pi Coding Agent](https://pi.dev) extension that keeps a persistent todo list for each project and displays it in a live terminal UI widget.

Tasks are stored in `.pi/todo.json`, so the list survives across sessions and remains scoped to the current project.

## Features

- Persistent per-project task storage in `.pi/todo.json`
- Sequential numeric task IDs (`01`, `02`, …)
- Two task states: `pending` and `done`
- LLM `todo` tool with add, update, toggle, remove, list, clear, and reorder actions
- CLI-style `/todo` slash commands
- Live widget above the editor with task counts and status icons
- Automatic widget refresh when `.pi/todo.json` changes externally
- `Alt+T` shortcut to collapse or expand the widget
- No additional runtime dependencies beyond the pi extension environment

## Installation

Place the extension files in pi's global extensions directory:

```sh
mkdir -p ~/.pi/agent/extensions/todo
git clone https://github.com/rokiden/pi-todo.git ~/.pi/agent/extensions/todo
```

If the directory already contains a checkout, update it instead:

```sh
git -C ~/.pi/agent/extensions/todo pull
```

The extension consists of these files:

| File | Purpose |
| --- | --- |
| `index.ts` | Registers the tool, slash command, shortcut, and session hooks |
| `store.ts` | Reads and writes `.pi/todo.json` and implements task operations |
| `render.ts` | Renders the widget and tool results |
| `schemas.ts` | Defines the tool parameter schema |

Restart pi after installing or updating the extension.

## Slash commands

```text
/todo add Build the login page
/todo reword 01 Build and test the login page
/todo toggle 01
/todo list
/todo reorder 02 up
/todo remove 01
/todo remove *
/todo clear
```

Running `/todo` without an action displays the current list. Toggling cycles between `pending` and `done`. The `clear` command removes completed tasks, while `remove *` removes every task and resets the counter.

The widget is hidden when there are no tasks. Press `Alt+T` to switch between the full widget and its one-line collapsed summary.

## Todo tool

The extension also registers a `todo` tool for the agent with these actions:

| Action | Required parameters | Description |
| --- | --- | --- |
| `add` | `text` | Create a task |
| `update` | `id` | Change a task's text and/or status |
| `toggle` | `id` | Switch between `pending` and `done` |
| `remove` | `id` | Delete a task |
| `list` | — | List tasks; optionally filter by status |
| `clear` | — | Remove completed tasks |
| `reorder` | `id`, `direction` | Move a task `up` or `down` |

## Data format

A project store looks like this:

```json
{
  "items": [
    {
      "id": "01",
      "text": "Build the login page",
      "status": "pending",
      "createdAt": "2026-01-01T12:00:00.000Z",
      "updatedAt": "2026-01-01T12:00:00.000Z"
    }
  ],
  "counter": 1
}
```

The `.pi` directory and `todo.json` file are created automatically when the first task is added.
