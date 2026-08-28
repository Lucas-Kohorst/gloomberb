# 065 — Agent as a first-class Gloom user

> Finish plan 057 v1. The agent uses the live desk. It does not write a
> second app. Layouts, panes, series, and commands stay the computer.
>
> Steal Pi's tight loop (edit, `/reload`, see it). Do not steal Pi's
> coding-agent computer (bash, worktrees, file-edit as the way to add a
> chart).

## Status

- **Priority**: P1
- **Effort**: L (phased; each PR is M or S)
- **Risk**: MED (data ops share pane rate limits; hosted tool-loop is the
  reliability change)
- **Depends on**: 057 v0 (done), 062 registerAgentTool (done, unused),
  064 prompt fragments (done, unused)
- **Category**: agents / platform
- **Planned at**: 2026-08-27, working tree on `c01396c5`
- **v1 PARTIAL** — PR A (data ops) and PR D (tool lifecycle) landed in working tree. PRs B, C, E remain.

## Product rule (unchanged from 057)

If a human can see it or do it in Gloomberb, an agent can reach it.
Derive tools from inventories the app already maintains.
Call the same service functions the panes call.

This is still **not** a bb-style code-agent / worktree runner.

## What is already true (do not rebuild)

| Piece | Where | Use it |
|---|---|---|
| AGENT pane | `local-agent-workspace`, shortcut `AGENT` | One chat. No second Assistant plugin. |
| Pi native loop | `createPiAiHost` + `runtime.runAgent` | TUI / desktop bun. Tools execute inside pi-agent-core. |
| Hosted Nano | `createBrowserAiRunHost` | One-shot JSON, then `applyRemoteControlText`. **Not a tool loop.** |
| In-process handle | `RemoteControlHost` → `setInProcessRemoteHandle` | Hosted and native. Prefer this over TCP. |
| Remote inventories | `app://pane-types`, `pane-templates`, `commands`, `connections` | Generated tools. |
| UI ops | `layout.*`, `pane.show`, `pane.createFromTemplate` | Dashboard emission + undo. |
| Chart seed | `chart-composer-pane` + `options.arg` | `POLY:…, FRED:FEDFUNDS`. Empty `pane.show` is a documented trap. |
| Market-data `data` | 18 ops in `queryMarketData` | search, quote, financials, filings, holders, research, actions, earnings, econ.series, watchlists.get, portfolios.get, articles.search, polls.list, indices.list, indices.get, markets.search, markets.get, markets.history. |
| Plugin tool API | `ctx.registerAgentTool` / `registerAgentPromptFragment` | Landed. `registerTool` replaces on name collision. `unregister` drops tools + fragments on plugin remove. No production plugin calls them yet. |
| File tools | `write_file` / `reload_plugin` under `~/.gloomberb/plugins/` | Native only. Hosted has no disk watch. |
| Receipts | `extractActionReceipts` in workspace | Undo via `layout.undo`. |

## What is not true (the gaps)

1. **Data.** ~~`RemoteMarketDataRequest` still only has the 8 ticker ops.~~
   **Done (PR A).** All 10 new data ops landed: `econ.series`,
   `watchlists.get`, `portfolios.get`, `articles.search`, `polls.list`,
   `indices.list`, `indices.get`, `markets.search`, `markets.get`,
   `markets.history`. Each calls the same function the pane uses.
2. **Hosted reliability.** Chrome Nano cannot iterate `get` then `call`
   unless the first JSON is a `batch`. `Ask AI` and command-bar assist
   run `plain` / `runText` with no tools. Factory still double-applies
   leftover JSON after `runAgent`.
3. **Speed.** Remote / CLI / show tools set `executionMode: "sequential"`.
   `gloomberb_cli` serializes through `cliCaptureMutex` and monkey-patches
   `console.*`. Every UI mutation waits rAF or 50ms then `setTimeout(0)`
   (`afterMutation` in `app-host.tsx`). Pi `AgentTool.executionMode` is
   static on the tool, not per-call, so reads and writes share the same
   mode. Parallel reads skipped (honest, not faked).
4. **Plugin exposure.** ~~Tools and prompt fragments are not unregistered
   on `removePlugin`.~~ **Done (PR D).** `registerTool` replaces on name
   collision. `unregister` drops tools + fragments. Hosted browser host
   still has no `registerTool`. No production plugin calls the APIs yet.
5. **Two computers.** Native AGENT can dump econ/fred/indices/rss via
   CLI JSON that does not open panes. Hosted AGENT cannot. The live desk
   is the product. CLI dumps are a side channel.

## Steal from Pi. Do not copy BB.

BB is not on disk. Pi's public model is
[extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
in `earendil-works/pi` (the old `badlogic/pi-mono` tree).

Pi extensions are TypeScript modules in `~/.pi/agent/extensions/` or
`.pi/extensions/`. They `pi.registerTool()`, subscribe to lifecycle
events, and **hot-reload with `/reload`**. Pi itself is not a charting
runtime. A "live chart plugin" in that world is generated app code plus
a process or module reload.

Gloom already has the analogue:

- write a series id, not a `.ts` file
- `pane.createFromTemplate` with `options.arg`, not `import()`
- receipts + `layout.undo`, not git stash
- `watchPluginsDir` / `reload_plugin` for **user plugins on native**,
  which is the optional escape hatch, not the default path

Copy the loop tightness. Do not copy bash, worktrees, or "the agent
authors a pane to plot two series."

## Target loop (acceptance)

These turns must work on TUI, desktop, **and** hosted (`terminal.kohor.st`)
with a connected provider or Chrome Nano.

1. "Pull up info on me and edit my layout to fit what I do"
   → `watchlists.get` + `portfolios.get` + `layout.new` +
   `pane.createFromTemplate` × N + receipt + undo.
2. "Show fed funds against Polymarket odds historical"
   → `econ.series` + `markets.history` + `pane.createFromTemplate`
   `chart-composer-pane` with `options.arg`.
3. "Explore the data-driven surge in Democrats"
   → `articles.search` + `polls.list` + `indices.list` +
   `markets.search` + `layout.new`.
4. "Open SEC AAPL" still works (v0).
5. Hosted Nano can `get app://snapshot` **then** `call` in a later
   turn or tool step, not only as a pre-baked `batch`.

## Phasing (one PR each)

### PR A — Data ops (057 v1)

**Files.** `src/remote/types.ts`, `controller.ts`, `schema.ts`,
plus the pane fetch functions already used by news, VoteHub, Adjacent
indices, prediction markets, econ/FRED, watchlists/portfolios.

**Build.**

- Extend `RemoteMarketDataRequest` (or a sibling `RemoteDataRequest`
  if ticker ops should stay narrow) with:
  `articles.search`, `polls.list`, `indices.list`, `indices.get`,
  `markets.search`, `markets.get`, `markets.history`, `econ.series`,
  `watchlists.get`, `portfolios.get`.
- Each op calls the **same function the pane uses**.
- Wrap fetches with `withConnectionRequest`. A test asserts a source id
  is reported.
- Do not add a second Adjacent/Kalshi client.
- If the pane cannot see it on hosted, the agent cannot either.

**You see.** AGENT "fed funds series" returns FRED points without
`gloomberb_cli econ`. Connections shows the request.

**Verify.**

- Unit: `controller` tests for each new op + unknown-op still throws.
- Live: AGENT on TUI opens chart-composer from returned series ids.
- Perf: one `econ.series` vs the pane's own FRED fetch. Head must not
  add a second HTTP client. Same connection id.

### PR B — Chart and series as one path

**Depends on.** A, or land in the same PR if the arg seed already
covers the demo (it does for FRED + POLY). Split if A is large.

**Files.** `src/plugins/builtin/chart-composer/index.tsx`,
`src/remote/schema.ts` help recipes, AGENT system prompt,
optional `app://series` resource listing known expression prefixes
(`AAPL:price`, `FRED:`, `ADJ:`, `KALSHI:`, `POLY:`).

**Build.**

- Keep `pane.createFromTemplate` + `options.arg` as the only chart
  write path.
- Expand `app://pane-templates` / help so the model does not
  `pane.show` an empty composer.
- Do not generate a plugin to draw a chart.

**You see.** "Chart FEDFUNDS vs POLY:fed-cut" creates a seeded
Custom Chart pane. Empty composer does not appear.

### PR C — Hosted tool loop

**Depends on.** A (data ops must exist or hosted still has nothing
to iterate on).

**Files.** `src/plugins/builtin/ai/browser.ts`, hosted run host,
`src/remote/in-process-handle.ts`.

**Build.**

- Hosted structured mode must call `getInProcessRemoteHandle()` in a
  **loop**, not one JSON blob. Minimum: Nano/BYOK emits a tool call
  (`get` / `call` / `data`), host executes, model sees the result,
  repeats until a text answer.
- If Chrome Prompt API cannot do multi-step tool use, keep JSON
  `batch` as fallback and say so in the pane. Do not pretend it
  iterated.
- `Ask AI` stays ticker-local unless we explicitly add tools. Do not
  silently give Ask AI layout mutation.
- Browser host should no-op `registerTool` today. Either implement it
  or keep plugin tools native-only and document that.

**You see.** Hosted AGENT: get snapshot, then create a pane, in two
model steps. `remote_unavailable` does not fire when `RemoteControlHost`
is mounted.

### PR D — Reliability and speed of the existing loop

**Depends on.** none. Can land parallel to A.

**Files.** `src/plugins/builtin/ai/pi/agent-tools.ts`, `pi/host.ts`,
`src/plugins/registry/contributions.ts`, `src/remote/app-host.tsx`.

**Build.**

- Unregister plugin-contributed tools and prompt fragments on
  `removePlugin` / reload. `registerTool` collisions must not leak
  the old plugin's execute closure.
- Mark **read** remote ops (`help`, `schema`, `get`, `data`) as
  parallel-capable. Keep `call` / `patch` sequential.
- Stop recommending `gloomberb_cli` for ops that PR A now serves as
  `data`. CLI stays for plugin scaffold (`new`, `validate`) on native.
- Measure `afterMutation` 50ms. Do not remove it without a live
  semantic-UI flake. If it stays, document why.

**You see.** Reload a user plugin twice. AGENT tools list does not
duplicate. Two `get`s in one turn can overlap.

### PR E — Plugins describe themselves to the agent

**Depends on.** D (unregister) and A (data ops to wrap).

**Files.** First callers, not the API (API exists):

- chart-composer prompt fragment: series grammar
- news / WIRE: `articles.search` description
- prediction-markets: `markets.*`
- econ: `econ.series`
- connections: "agent fetches must show up here"

**Build.**

- Each `setup()` calls `ctx.registerAgentTool` **or** a prompt
  fragment. Prefer fragments when the tool is already
  `gloomberb_remote` `data`. Do not register a second HTTP client
  as a custom tool.
- `PLUGINS.md` documents `registerAgentTool` (it does not today).
- Inventory test: visible templates still require `description`.

**You see.** AGENT "what series can I chart?" answers from the
chart-composer fragment, not from guessing.

## STOP

- Do not spawn Claude Code / Codex / worktrees / `Bun.spawn` as the
  way to add charts.
- Do not route hosted tools through `capability.invoke`.
- Do not add a second chat pane.
- Do not replace SQLite with DuckDB.
- Do not invent a Gloom-specific coding-agent extension dir that
  duplicates `~/.gloomberb/plugins/` plus Pi's `~/.pi/agent/extensions/`.
- Do not generate plugin source to plot two series the composer already
  accepts as `options.arg`.
- If Chrome Nano cannot emit valid multi-step tool JSON, fall back to
  `batch` and say so. Do not require a paid key for layout edits.

## Files to start from

- `src/remote/types.ts`, `controller.ts`, `schema.ts`
- `src/plugins/builtin/ai/pi/host.ts`, `browser.ts`, `agent-tools.ts`
- `src/plugins/builtin/ai/workspace/pane.tsx`
- `src/plugins/builtin/chart-composer/index.tsx`
- `src/plugins/registry/context.ts`, `contributions.ts`
- `src/plugins/builtin/connections/register.ts`
- Plan 057 (v1 table), 062, 064

## Tests worth keeping

- Remote controller: each new data op + Connections source id.
- Chart seed: `options.arg` with FRED + POLY still builds a spec.
- Hosted: handle used (no TCP, no `capability.invoke`).
- Plugin reload: tools dropped on unregister.
- Registry: missing template/command description still fails.

Skip tests that only assert copied chrome strings.

## Suggested PR order

A and D first (independent). B after A. C after A. E after D and A.

Native AGENT already rearranges layouts. The hole is data, hosted
iteration, and plugins that never describe themselves.
