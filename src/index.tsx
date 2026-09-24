// briefing-room: an opencode TUI sidebar panel listing the subagents (task
// tool child sessions) currently on the roster, each with a pixel-art sprite
// for its agent type (explore, scout, general, plan, ...). A subagent joins
// the roster when its session is created/updated and stays until a new prompt
// is submitted to the main session -- going idle does not drop it, so the
// panel reads as a running log of this turn's operatives. Tokens/model/cost
// come straight off the session.updated payload (the Session already carries
// them), with a debounced messages fetch only as a fallback when they are
// missing. Rendered through the sidebar_content slot, so it must be loaded
// from tui.json's plugin array -- server-plugin auto-discovery does not apply
// to TUI plugins. Requires solid-js and @opentui/solid resolvable at load time
// (local TUI plugins resolve from ~/.config/opencode/node_modules, unlike npm
// plugins which use opencode's package cache -- issue opencode#34050).
/** @jsxImportSource @opentui/solid */
import { createSignal } from "solid-js"
import { TextAttributes } from "@opentui/core"
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { SPRITES } from "./sprites.ts"

type Sub = {
  title: string
  status: string
  agent?: string
  model?: string
  tokens?: number
  cost?: number
}

const tui: TuiPlugin = async (api) => {
  const [subs, setSubs] = createSignal<Record<string, Sub>>({})
  const theme = api.theme.current

  // Session IDs known to be subagents (have a parentID). Used to tell a
  // subagent's own task prompt apart from a user prompt on the main session.
  const childIds = new Set<string>()

  const fmtTokens = (n?: number) =>
    n == null ? "?" : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
  const fmtCost = (n?: number) => `$${(n ?? 0).toFixed(2)}`

  const stateColor = (status: string) =>
    status === "busy"
      ? theme.success
      : status === "retry"
        ? theme.warning
        : theme.textMuted
  const stateLabel = (status: string) =>
    status === "busy"
      ? "running"
      : status === "retry"
        ? "retrying"
        : status === "idle"
          ? "done"
          : status

  const sumTokens = (t: any) =>
    (t.input ?? 0) + (t.output ?? 0) + (t.reasoning ?? 0) + (t.cache?.read ?? 0) + (t.cache?.write ?? 0)

  // Fallback: fetch the child's last assistant message for model/tokens/cost.
  // Only used when the session.updated payload lacks tokens. Debounced so
  // streamed part updates coalesce.
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const refresh = (sessionID: string) => {
    clearTimeout(timers.get(sessionID))
    timers.set(
      sessionID,
      setTimeout(async () => {
        try {
          const res: any = await api.client.session.messages({ sessionID } as any)
          const rows: any[] = res.data ?? res ?? []
          const last = [...rows]
            .reverse()
            .find((m) => m.info?.role === "assistant" && m.info?.tokens)?.info
          if (!last) return
          setSubs((prev) =>
            prev[sessionID]
              ? {
                  ...prev,
                  [sessionID]: {
                    ...prev[sessionID],
                    model: last.modelID,
                    tokens: last.tokens.total ?? sumTokens(last.tokens),
                    cost: last.cost,
                  },
                }
              : prev,
          )
        } catch {}
      }, 400),
    )
  }

  const spriteColor = (agent?: string) => {
    const a = agent?.toLowerCase()
    return a === "explore"
      ? theme.warning
      : a === "scout"
        ? theme.info
        : a === "plan"
          ? theme.success
          : a === "general"
            ? theme.accent
            : theme.textMuted
  }

  const sprite = (agent?: string) => {
    const rows = SPRITES[agent?.toLowerCase() ?? ""] ?? SPRITES.fallback!
    const fg = spriteColor(agent)
    // Rasterize 12x12 pixels to 6 lines of half-block glyphs: each source
    // pixel is one half of a terminal cell (square, since a cell is ~2x as
    // tall as wide). Pair row 2k (top) with 2k+1 (bottom): both -> "█", top
    // only -> "▀", bottom only -> "▄", neither -> space.
    const lines: string[][] = []
    for (let i = 0; i < rows.length; i += 2) {
      const top = rows[i] ?? ""
      const bottom = rows[i + 1] ?? ""
      const line: string[] = []
      for (let j = 0; j < top.length; j++) {
        const t = top[j] === "#"
        const b = bottom[j] === "#"
        line.push(t && b ? "█" : t ? "▀" : b ? "▄" : " ")
      }
      lines.push(line)
    }
    return (
      <box marginRight={1}>
        {lines.map((line) => (
          <text>
            {line.map((ch) =>
              ch === " " ? (
                <span> </span>
              ) : (
                <span style={{ fg, bg: theme.background }}>{ch}</span>
              ),
            )}
          </text>
        ))}
      </box>
    )
  }

  const offs = [
    api.event.on("session.updated", (evt: any) => {
      const info = evt.properties?.info
      if (!info?.parentID) return
      childIds.add(info.id)
      if (!subs()[info.id] && Date.now() - (info.time?.created ?? 0) > 10000) {
        // Stale child (finished long ago or pre-restart): only track if the
        // server still reports it busy, else old subagents would linger.
        void (async () => {
          try {
            const res: any = await (api.client as any).session.status({})
            const map = res.data ?? res ?? {}
            const type = map[info.id]?.type
            if (type === "busy" || type === "retry")
              setSubs((prev) => ({
                ...prev,
                [info.id]: {
                  title: info.title ?? info.id.slice(0, 8),
                  agent: info.agent,
                  status: type,
                },
              }))
          } catch {}
        })()
        return
      }
      setSubs((prev) => {
        const prevSub = prev[info.id]
        return {
          ...prev,
          [info.id]: {
            title: info.title ?? info.id.slice(0, 8),
            agent: info.agent,
            status: prevSub?.status ?? "running",
            tokens: info.tokens ? sumTokens(info.tokens) : prevSub?.tokens,
            cost: info.tokens ? info.cost : prevSub?.cost,
            model: info.tokens ? info.model?.id : prevSub?.model,
          },
        }
      })
      if (!info.tokens) refresh(info.id)
    }),
    api.event.on("session.status", (evt: any) => {
      const { sessionID, status } = evt.properties ?? {}
      if (!sessionID) return
      setSubs((prev) => {
        if (!prev[sessionID]) return prev
        return {
          ...prev,
          [sessionID]: { ...prev[sessionID], status: status?.type ?? prev[sessionID].status },
        }
      })
    }),
    api.event.on("message.updated", (evt: any) => {
      const sessionID = evt.properties?.sessionID
      if (sessionID && subs()[sessionID]) refresh(sessionID)
    }),
    api.event.on("session.next.prompted", (evt: any) => {
      const { sessionID, delivery } = evt.properties ?? {}
      if (!sessionID) return
      if (delivery !== "steer") return // queued prompts don't clear the roster
      if (childIds.has(sessionID)) return // a subagent's own task prompt
      setSubs({})
    }),
  ]
  api.lifecycle.onDispose(() => {
    offs.forEach((off) => off())
    timers.forEach((t) => clearTimeout(t))
  })

  api.slots.register({
    order: 450, // between internal todo (400) and files (500)
    slots: {
      sidebar_content() {
        const list = Object.values(subs())
        return (
          <box>
            <text attributes={TextAttributes.BOLD}>Subagents</text>
            {list.length === 0 ? (
              <text>none running</text>
            ) : (
              list.map((c) => (
                <box>
                  <box flexDirection="row">
                    {sprite(c.agent)}
                    <box>
                      <text>{c.title}</text>
                      <text>
                        <span style={{ fg: theme.textMuted }}>
                          {`${c.model ?? "?"} · ${fmtTokens(c.tokens)} tok · ${fmtCost(c.cost)}`}
                        </span>
                        <span style={{ fg: stateColor(c.status) }}>
                          {` · ${stateLabel(c.status)}`}
                        </span>
                      </text>
                    </box>
                  </box>
                </box>
              ))
            )}
          </box>
        )
      },
    },
  })
}

export default { id: "briefing-room", tui } satisfies TuiPluginModule
