# 057 — Agent surface parity (the terminal is the agent's computer)

> Product rule: **if a human can see it or do it in Gloomberb, an agent can
> reach it.** Do not invent a second tool zoo. Derive tools from inventories
> the app already maintains, and call the same service functions the panes
> call.
>
> This is **not** a bb-style code-agent / worktree runner. Layouts, panes,
> datasets, and commands are the computer. Hosted web is a first-class
> surface because nothing here needs `Bun.spawn`.

## Status

- **Priority**: P1
- **Effort**: L (phased; v0 is M)
- **Risk**: MED (layout mutation is undoable; data tools share rate limits)
- **Depends on**: existing remote protocol + AI Agent pane (already on `main`)
- **Category**: agents / platform
- **Planned at**: 2026-08-25, `origin/main` @ `7b0f66cb`

## What is already true (do not rebuild)

| Piece | Where | Use it |
|---|---|---|
| Remote protocol | `src/remote/schema.ts`, `controller.ts`, `resources.ts` | `get` / `call` / `patch` / `batch` + market-data ops |
| In-process host | `RemoteControlHost` in `src/app.tsx` (all surfaces) | TCP server is optional; the controller is already in-process |
| Layout ops | `layout.new/switch/undo/redo/setGrid/placePane` | Dashboard emission + undo |
| Pane ops | `pane.show/focus/createFromTemplate/setSetting` | Open `SEC AAPL`, configure panes |
| Command inventory | `app://commands`, `app://pane-templates` | Generated tool manifest |
| Market-data tools | `RemoteMarketDataRequest` + `gloomberb_market_data` | search, quote, financials, filings, holders, research, actions, earnings |
| Pi remote tool | `gloomberb_remote` in `src/plugins/builtin/ai/pi/host.ts` | Desktop/TUI agent loop |
| AI Agent pane | `local-agent-workspace`, shortcut `AGENT` | Chat surface exists |
| Chrome Prompt API | hosted run host (`browser-builtin`) | Free on-device path; no Pi key |
| Connections | `registerConnectionSource` + `withConnectionRequest` | Agent fetches must report here |

`RemoteAppKind` is only `"tui" | "desktop"`. Hosted already mounts
`RemoteControlHost`; it does **not** currently give the hosted AI runner an
in-process `handle`. That is the v0 hole.

## Principle

```
human UI  ==  registry + service functions + remote controller
agent UI  ==  the same three, plus a chat that shows receipts
```

Do **not** build tools on `plugin.capabilities` invoke. AGENTS.md: hosted
disables capability handlers. `capability.invoke` on hosted is a trap.

Do **not** let agent HTTP bypass `withConnectionRequest`. Kalshi ×40 to build
a dashboard must show up in Connections.

## Tool layers

### Generated (keep generating)

| Inventory | Resource / op | Agent sees |
|---|---|---|
| `pluginRegistry.panes` | `app://pane-types` | id, name, settings schema (today: thin — expand) |
| `pluginRegistry.paneTemplates` | `app://pane-templates` + `pane.createFromTemplate` | label, description, shortcut, keywords |
| `pluginRegistry.commands` | `app://commands` + `app.search` / `commandBar.activateResult` | every command-bar action |
| Saved layouts + history | `app://layouts` + `layout.*` | create / switch / undo |
| Connections registry | **missing resource** | `app://connections` — what sources are live |
| Semantic UI | `ui://tree` + `ui.invokeMatching` | last resort for visible controls |

Today `app://pane-types` returns `{ id, name, defaultPosition, defaultMode, hasSettings }`.
That is not enough to emit a valid layout. Expand it to include the resolved
settings field list (same as `app://pane-settings/{paneId}` but per type, with
defaults) and the template shortcut/description.

`CommandDef.description` is optional. Templates already require `description`.
Enforcement: a unit test over the live registry (or a fixture that loads
builtin plugins) fails if a **visible** command or pane template ships without
a description the assist inventory can use.

### Hand-written data tools (extend `RemoteMarketDataRequest`)

Existing: `search`, `quote`, `financials`, `secFilings`, `holders`,
`analystResearch`, `corporateActions`, `earningsCalendar`.

Add, each calling the **same function the pane uses**:

| Op | Pane it mirrors | Notes |
|---|---|---|
| `articles.search` | WIRE / RSS / Adjacent news / ART | Open via existing article reader op or `pane.createFromTemplate` |
| `polls.list` | VoteHub / polls | |
| `indices.list` / `indices.get` | Adjacent Indices | Auth path on hosted (worker key) |
| `markets.search` / `markets.get` / `markets.history` | Prediction Markets | Adjacent catalog on hosted; venue books stay venue-native |
| `econ.series` | Econ / FRED | |
| `watchlists.get` / `portfolios.get` | PF / PORT | User context for “edit my layout to fit what I do” |

Do not add a second Adjacent/Kalshi client. If the pane cannot see it on
hosted, the agent cannot either.

### Explicitly out of v0

- bb worktrees / provider CLI spawn / permission sandbox for file edits
- Extra PM venues
- DuckDB (see `plans/056-duckdb-vs-sqlite.md`) — keep SQLite KV
- ETF create/redeem (no source)

## Hosted vs desktop

| Surface | How the agent calls the controller |
|---|---|
| TUI / Electrobun | Existing: Pi `gloomberb_remote` → local remote server **or** in-process handle |
| Hosted web | **New:** inject `controller.handle` into the hosted AI run host. No TCP, no `dataDir` socket. Chrome Nano / Ollama-N/A / BYOK all go through the same handle. |

`createAppRemoteController` already takes `getState` + `dispatch`. Hosted
`config.save` stays a backend no-op; layout writes still go through
`writeHostedUserConfig()` and Gloom Cloud sync when the session is verified.
Do not let a stale cloud pull wipe a newer hosted local save (existing rule).

## Chat UX (extend the existing AI Agent pane)

Do not add a second Assistant plugin. Teach `local-agent-workspace`:

1. **Receipts** — every successful `call` / `patch` renders as a row:
   `created layout “Democrats” · 4 panes` with **Undo** bound to `layout.undo`
   (or the inverse op). Trust comes from reversibility; layout history is
   already there.
2. **In-process tools on hosted** — when `isHostedWebClient()`, attach a
   `gloomberb_remote` tool that calls `controller.handle` directly, plus the
   extended market-data ops.
3. **Shortcut** — `AGENT` already exists. Also expose it to assist inventory
   (already has description). No new prefix required unless we add a
   “build dashboard” wizard.
4. **Footer** — live/error/auth only. `[r]`efresh is N/A for a chat; keep
   send. If a receipt has an external URL, `[o]`pen.

Example turns (acceptance):

- “Pull up info on me and edit my layout to fit what I do” →
  `watchlists.get` + `portfolios.get` + `layout.new` + `pane.createFromTemplate`
  × N + receipt + undo.
- “Show fed funds against Polymarket odds historical” → `econ.series` +
  `markets.history` + chart-composer template.
- “Explore the data-driven surge in Democrats” → `articles.search` +
  `polls.list` + `indices.list` + `markets.search` + `layout.new`.

## Enforcement (keep parity true)

1. **Registry test** — every non-hidden command and every pane template has
   `description` (and templates keep `shortcut` or an explicit `hidden`).
2. **Remote schema test** — `REMOTE_RESOURCES` / `REMOTE_OPERATIONS` include
   connections + the new data ops; `app://pane-types` includes settings
   fields.
3. **Connections** — new data ops wrap the pane fetch with
   `withConnectionRequest`. A test that the op reports a source id.
4. **No capability-only sources** — do not register a data tool that only
   exists as `plugin.capabilities`.

## Phasing

### v0 — hosted handle + receipts (ship first)

- Pass `controller.handle` into the hosted AI run host / Agent pane.
- Receipt rows + undo for `layout.*` and `pane.createFromTemplate`.
- Expand `app://pane-types` with settings fields.
- `app://connections` read-only resource.
- Registry description test.

Already enough for “rearrange my layout” and “open SEC AAPL” on
`terminal.kohor.st` with Chrome Nano or a BYOK key.

### v1 — data ops

- articles, polls, indices, markets, econ, watchlists/portfolios.
- Chart-composer template from two series ids.

### v2 — proactivity

- Suggest a pane (“NVDA reported; want the filing?”).
- Script-mode cron later (no model); not this plan’s first PR.

## STOP

- Do not spawn Claude Code / Codex / worktrees in this plan.
- Do not route hosted tools through `capability.invoke`.
- Do not replace SQLite with DuckDB.
- Do not add a second chat pane beside `AGENT`.
- If Chrome Nano cannot emit valid `call` JSON, fall back to the existing
  structured-output parser pattern (screener Nano recovery) — do not require
  a paid key for v0 layout edits.

## Files to start from

- `src/remote/schema.ts` — resources + ops
- `src/remote/resources.ts` — `app://pane-types`, new `app://connections`
- `src/remote/controller.ts` — new data ops next to existing market-data
- `src/remote/app-host.tsx` — expose `handle` to React context
- `src/plugins/builtin/ai/pi/host.ts` — hosted in-process tool
- `src/plugins/builtin/ai/workspace/pane.tsx` — receipts
- `src/plugins/registry/` — description enforcement test
- `src/plugins/builtin/connections/register.ts` — inventory for `app://connections`

## Tests worth keeping

- Remote controller: new ops + pane-types shape + connections resource.
- Agent pane: receipt renders and undo calls `layout.undo`.
- Registry: missing description fails.
- Hosted tool: `handle` is used (no `remote-control.json` / TCP).

Skip tests that only assert copied chrome strings.
