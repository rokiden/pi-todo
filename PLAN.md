# pi-todo — Fork Plan

Fork of [pi-todo v1.2.0](https://github.com/mrg2400xx/pi-todo) with simplifications and new features.

## Location
`~/.pi/agent/extensions/todo/` (global extension, replaces npm package behavior in all projects)

## Planned Changes from Upstream pi-todo v1.2.0

### Remove
- `priority` field & enum — no longer tracked on tasks
- `assignee` field — no longer tracked
- `blockedBy` field — no dependency tracking

### Add
- CLI-style `/todo` slash command parsing — args like:
  - `/todo add Build login page` → creates task
  - `/todo toggle T-001` → cycles pending → in-progress → done
  - `/todo remove T-001` → deletes single task
  - `/todo remove *` → removes all tasks at once
  - `/todo list` — (no filter, shows everything)
  - `/todo clear` — clears completed items only
- `Alt+T` hotkey — collapses/expands the widget visibility

### Unchanged
- Per-project JSON storage in `.pi/todo.json`
- Auto-generated IDs (`T-001`, `T-002`, …)
- Sequential counter mechanism
- Synchronous file I/O
- Live TUI widget (simplified — no priority coloring, no assignee display)
- Session lifecycle hooks (`session_start` loads widget, `session_shutdown` clears it)
- Zero external dependencies beyond TypeBox

## Files

| File | Purpose |
|------|---------|
| `index.ts` | Extension entry point — registers tool, slash command handler (with CLI arg parsing), shortcut (`Alt+T`), session hooks |
| `store.ts` | File I/O — read/write `.pi/todo.json`, CRUD operations without priority/assignee/blockedBy |
| `render.ts` | TUI rendering — simplified widget (no priority colors, no assignee/blocked annotations) + tool result formatting |
| `schemas.ts` | TypeBox schema for the LLM tool — simplified params |

## Data Format (.pi/todo.json)

```json
{
  "items": [
    {
      "id": "T-001",
      "text": "...",
      "status": "in-progress",
      "createdAt": "2026-07-05T19:02:00Z",
      "updatedAt": "2026-07-05T19:02:00Z"
    }
  ],
  "counter": 1
}
```

## Implementation Order
1. `store.ts` — simplify CRUD (remove priority, assignee, blockedBy)
2. `schemas.ts` — remove unused enums & params
3. `render.ts` — strip priority/assignee UI elements
4. `index.ts` — CLI arg parsing for slash command + `Alt+T` shortcut registration
