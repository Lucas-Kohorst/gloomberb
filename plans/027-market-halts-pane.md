# Plan 027: Add Market Halts pane

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3381ada..HEAD -- src/plugins/builtin/market-movers/ src/plugins/builtin/econ/`
> If the market-movers or econ pattern has changed significantly, treat as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW/MED
- **Depends on**: none
- **Category**: godel-parity
- **Planned at**: commit `3381ada`, 2026-08-17

## Why this matters

Market trading halts are critical real-time surveillance data. Godel's `HALT` command shows today's US market halts from the Nasdaq trader feed with reason codes, halt times, and resumption times. Gloom has market movers (`MOST`) and a heatmap (`HM`) but no halt surveillance. The Nasdaq Trader halt feed is publicly accessible, making this a zero-cost feature that fills a real-time monitoring gap.

## Godel reference

- **Command**: `HALT` (Market Halts)
- **Docs**: https://godelterminal.com/docs/commands/halt.html
- **Function**: Today's US market trading halts with filter tabs (All / Active / Resumed). Columns: Ticker, Exchange, Name, Halt Code (with plain-English tooltip), Halt Time, Quote Resume Time, Trading Resume Time. Color-coded by status (red = active, theme = quoting resumed, uncolored = fully resumed). US markets only.

## Current state

**Existing patterns to follow:**

1. **Market movers pane** (`src/plugins/builtin/market-movers/`) — market-wide tabular data with sortable columns, refresh, and status footer. This is the closest pattern: market surveillance data fetched on demand with refresh.

2. **Econ calendar pane** (`src/plugins/builtin/econ/`) — tabular data with filter tabs (by date/category), sortable columns, `[r]efresh`. The filter tab pattern (All/Active/Resumed) maps to econ's filter approach.

3. **Congress trades pane** (`src/plugins/builtin/congress-trades/`) — cloud-backed tabular data with sortable columns, detail view, footer hints.

**Data source:**

Nasdaq Trader halt feed — public, no auth:
- URL: `https://www.nasdaqtrader.com/RPCHandler.axd?t=halts` (returns JSON or XML)
- Alternative: `https://api.nasdaq.com/api/ishals/halt` (may require headers)
- The Nasdaq Trader halt RSS/JSON feed lists current and recent halts with: Symbol, Halts (reason code), HaltDate, HaltTime, ResumeDate, ResumeQuoteTime, ResumeTime
- Common reason codes: LUDP (volatility pause), T1/T3 (pending news), T12 (additional info requested), H10 (SEC suspension), D (news dissemination)

**Important**: Verify the Nasdaq Trader endpoint with a real request before building the parser. The endpoint format may have changed. If the direct endpoint is CORS-blocked in the hosted web client, a cloud proxy endpoint will be needed.

**Plugin registration:**

This is a market-wide pane (not per-ticker), so it follows the market-movers / fear-greed pattern: register as a pane with a command-bar shortcut, no ticker binding.

**Connections registration:**

Register with `registerConnectionSource()` in plugin `setup()`.

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Typecheck | `bun run typecheck:opentui`      | exit 0              |
| Full TC   | `bun run typecheck`              | exit 0              |
| Tests     | `bun test`                       | all pass            |
| TUI test  | tmux session (see tui-testing skill) | pane renders     |

## Scope

**In scope** (create these files):
- `src/plugins/builtin/market-halts/types.ts` — TypeScript types for halt records
- `src/plugins/builtin/market-halts/client.ts` — Nasdaq Trader halt feed client
- `src/plugins/builtin/market-halts/model.ts` — normalization, reason-code lookup, filter, sorting, column definitions
- `src/plugins/builtin/market-halts/pane.tsx` — React pane component with filter tabs
- `src/plugins/builtin/market-halts/index.tsx` — PluginModule definition with pane + shortcut

**Modify**:
- `src/plugins/builtin/composite-plugins.ts` — add module to `marketOverviewPlugin`
- `src/plugins/catalog-backend.ts` — add import and registration
- `src/plugins/catalog-ui.ts` — add import and registration
- `README.md` — add `HALT` to command reference table

**Out of scope**:
- International market halts (feed is US-only)
- Historical halt archives (start with today's halts only)
- Alerting on new halts (could be a future enhancement using the alerts plugin)

## Git workflow

- Branch: `advisor/027-market-halts`
- Commit per file or logical unit; match repo commit style
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Verify Nasdaq Trader endpoint

Run a test request:

```bash
curl -s 'https://www.nasdaqtrader.com/RPCHandler.axd?t=halts' | head -c 2000
```

If that endpoint is deprecated, try:
```bash
curl -s 'https://api.nasdaq.com/api/ishals/halt' -H 'User-Agent: Mozilla/5.0' | head -c 2000
```

**STOP if**: No endpoint returns usable halt data. Report the raw responses.

### Step 2: Create types

Create `src/plugins/builtin/market-halts/types.ts`:

```typescript
export type HaltStatus = "active" | "quote_resumed" | "resumed";

export interface MarketHalt {
  ticker: string;
  exchange: string;        // listing market
  name: string | null;     // company name
  haltCode: string;        // Nasdaq reason code (LUDP, T1, T12, etc.)
  haltCodeDesc: string;    // plain-English description
  haltTime: Date;          // when trading was halted
  quoteResumeTime: Date | null;  // when quoting resumed
  resumeTime: Date | null;       // when trading fully resumed
  status: HaltStatus;
}

export type HaltFilter = "all" | "active" | "resumed";

export type LoadStatus = "idle" | "loading" | "loaded" | "error";
```

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 3: Create API client

Create `src/plugins/builtin/market-halts/client.ts` that:
- Fetches today's halts from the Nasdaq Trader endpoint
- Parses into `MarketHalt[]` with computed `status` field
- Uses `withConnectionRequest()` on the real fetch path
- Handles errors with clear messages
- Auto-refreshes every 30 seconds during market hours (9:30–16:00 ET) if live streaming is enabled

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 4: Create model (reason codes, filters, columns)

Create `src/plugins/builtin/market-halts/model.ts` with:
- `HALT_CODE_MAP`: Record<string, string> mapping reason codes to descriptions
- `computeStatus(halt)`: determines active/quote_resumed/resumed from timestamps
- `filterHalts(halts, filter)`: filter by All/Active/Resumed
- Column builder (Ticker | Exchange | Code | Halt Time | Quote Resume | Trading Resume)
- Sort function for each column (asc/desc toggle)

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 5: Create pane component

Create `src/plugins/builtin/market-halts/pane.tsx` following the market-movers pattern:
- `SegmentedControl` for filter tabs (All / Active / Resumed)
- Toolbar: last-updated timestamp, total halts count, active halts count
- `DataTableStackView` with sortable columns
- Row color: red for active, theme color for quote_resumed, default for resumed
- `LoadStatus` state management
- `[r]efresh` to reload, auto-refresh toggle via quick setting
- `usePaneStatusFooter` for status + hints
- `EmptyState` when no halts today, `Spinner` while loading
- Click row to open ticker in research pane (`ctx.selectTicker(halt.ticker)`)

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 6: Create plugin module

Create `src/plugins/builtin/market-halts/index.tsx`:

```typescript
import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";

export const marketHaltsModule: PluginModule = {
  panes: [{
    id: "market-halts",
    name: "Market Halts",
    icon: "H",
    component: MarketHaltsPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 96, height: 25 },
    quickSettings: [LIVE_STREAMING_QUICK_SETTING],
  }],
  paneTemplates: [{
    id: "market-halts-pane",
    paneId: "market-halts",
    label: "Market Halts",
    description: "Today's US market trading halts with reason codes and resumption times.",
    keywords: ["halt", "halts", "trading", "pause", "suspend", "nasdaq", "ludp", "t1"],
    shortcut: { prefix: "HALT" },
  }],
  setup(ctx) {
    const unregisters = [
      registerConnectionSource({
        id: "nasdaq-trader-halts",
        name: "Nasdaq Trader (Halts)",
        kind: "http",
        pluginId: "market-halts",
        authRequired: false,
      }),
    ];
    return () => unregisters.forEach((fn) => fn());
  },
};
```

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 7: Register in composite plugin and catalogs

Add `marketHaltsModule` to `marketOverviewPlugin` in `src/plugins/builtin/composite-plugins.ts`. Add imports to `src/plugins/catalog-backend.ts` and `src/plugins/catalog-ui.ts`.

**Verify**: `bun run typecheck` → exit 0

### Step 8: Update README

Add `HALT` to the command reference table in `README.md`.

**Verify**: `bun run typecheck` → exit 0

### Step 9: TUI test

Use tmux to verify:
1. Start TUI in tmux
2. Open command bar, type `HALT`, Enter
3. Verify pane opens with filter tabs and table
4. If market hours, verify halt data loads; if no halts, verify `EmptyState`
5. Test `[r]efresh`
6. Kill tmux session

**Verify**: Pane renders correctly

### Step 10: Full verification

**Verify**: `bun run typecheck` → exit 0, `bun test` → all pass

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun test` exits 0
- [ ] `HALT` shortcut opens the pane in the TUI
- [ ] Halt data loads from Nasdaq Trader feed
- [ ] Filter tabs (All / Active / Resumed) work
- [ ] Columns are sortable (click header)
- [ ] Row color coding by status works
- [ ] `[r]efresh` reloads data
- [ ] Connection source registered (shows in Connections pane)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The Nasdaq Trader halt endpoint is unreachable or returns an unexpected format — inspect the raw response and adjust the parser. If CORS blocks direct fetch from the hosted web client, add a cloud proxy endpoint (out of scope; report back).
- The halt feed is only available during market hours — ensure `EmptyState` handles non-market-hours gracefully.

## Maintenance notes

- Nasdaq Trader may change the halt feed URL or response format. The parser should handle unknown reason codes by displaying the raw code.
- Consider adding halt notifications via the alerts plugin as a future enhancement.
- The auto-refresh interval (30s) should be adjustable via pane settings.
