# opencode-briefing-room

An opencode TUI sidebar panel that keeps a live roster of the subagents
(`task` tool child sessions) running for the current turn. Each subagent shows
a small emoji for its agent type (`explore`, `scout`, `general`,
`plan`, …) instead of a text label, plus its model, token count and cost.

## What it shows

- **Emoji** per agent type (unknown agents get a `❓`).
- **Status** line: `running` / `retrying` / `done`, colored accordingly.
- **Model · tokens · cost**, read from the child session's latest state.

## Behavior

- A subagent joins the roster when its session is created/updated.
- It stays on the roster after going idle — the panel is a log of the current
  turn, not a live-only indicator.
- The roster clears only when a new prompt is **submitted** (delivered) to the
  main session. Queued prompts do not clear it, and a subagent's own task
  prompt does not clear it either.

## Install

TUI plugins load from `tui.json`'s `plugin` array, not `opencode.json`. Point
it at this repo's entry file:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["/absolute/path/to/opencode-briefing-room/src/index.tsx"]
}
```

The plugin imports `solid-js` and `@opentui/solid`. Local TUI plugins resolve
these from `~/.config/opencode/node_modules` (unlike npm plugins, which use
opencode's own package cache — opencode#34050). Either install the
dependencies there, or run `npm install` in this repo so they resolve from
the importer's own `node_modules`.

## Development

`npx tsc --noEmit` type-checks the plugin against the installed SDK types.
There is no build step — opencode loads the `.tsx` source directly.
