# Plan 025: Add Short Interest pane

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3381ada..HEAD -- src/plugins/builtin/holders/ src/plugins/builtin/ticker-detail/`
> If the holder/ticker-detail pattern has changed significantly, treat as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW/MED
- **Depends on**: none
- **Category**: godel-parity
- **Planned at**: commit `3381ada`, 2026-08-17

## Why this matters

Short interest is a core equity analysis function in every Bloomberg-style terminal (Godel's `SI`). It shows shares short, short ratio (days to cover), and average daily volume over time. Gloom has holders (`HDS`), insider trades (`INS`), and options (`OMON`) but no short-interest view. FINRA publishes short interest data twice monthly (mid-month and month-end) via a free public API, making this a high-value feature with zero data cost.

## Godel reference

- **Command**: `SI` (Short Interest)
- **Docs**: https://godelterminal.com/docs/commands/si.html
- **Function**: Historical short interest chart with shares short, short ratio (days to cover), and average daily volume. Default one year of data, twice-monthly FINRA reporting frequency. Scoped to a single ticker.

## Current state

**Existing patterns to follow:**

1. **Holders tab/pane** (`src/plugins/builtin/holders/`) — per-ticker data view registered as both a Ticker Research tab and a standalone pane. This is the closest pattern: per-ticker data fetched on demand, displayed in a table + chart layout.

2. **Insider trades tab** (`src/plugins/builtin/insider/`) — another per-ticker data view with sortable table and chart. Shows the `createTickerSurfacePaneTemplate` pattern for ticker-scoped panes.

3. **Historical prices pane** (`src/plugins/builtin/ticker-detail/data-panes/historical-prices.tsx`) — per-ticker chart + table with date range.

**Data source:**

FINRA Short Interest API — public, no auth:
- Endpoint: `https://api.finra.org/data/group/otcmarket/reg/shortinterest` (JSON POST with `{ "symbol": "AAPL", "limit": 100 }`)
- Alternatively, FINRA publishes a consolidated short interest file. The REST API at `https://api.finra.org/data/group/otcmarket/reg/shortinterest` accepts POST requests.
- Returns records with: `symbol`, `shortInterest` (shares short), `shortInterestRatio` (days to cover), `averageDailyVolume`, `settlementDate`
- Reporting frequency: twice monthly (mid-month and month-end settlement dates)

**Important**: Verify the FINRA API endpoint and response shape with a real request before building the parser. The API may require a POST body or specific headers. If the REST endpoint is unreliable, an alternative is scraping the FINRA short interest CSV from `https://www.finra.org/investors/learn-to-invest/advanced-investing/margin-and-short-interest` or using Yahoo Finance's short interest data (available via the quoteSummary modules).

**Fallback data source**: Yahoo Finance `quoteSummary` includes `shortRatio`, `shortPercentOfFloat`, and `shortPercentOut` via `modules=summaryDetail,defaultKeyStatistics`. This is already used by Gloom's Yahoo plugin for other financial data.

**Plugin registration:**

New panes that are per-ticker views follow the `createTickerSurfacePaneTemplate` pattern from `src/plugins/builtin/shared/ticker-surface.ts`. Register as both a Ticker Research tab and a standalone pane.

**Connections registration:**

Per AGENTS.md: "Every external API or data source is a Connection." Register with `registerConnectionSource()` in plugin `setup()`.

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Typecheck | `bun run typecheck:opentui`      | exit 0              |
| Full TC   | `bun run typecheck`              | exit 0              |
| Tests     | `bun test`                       | all pass            |
| TUI test  | tmux session (see tui-testing skill) | pane renders     |

## Scope

**In scope** (create these files):
- `src/plugins/builtin/short-interest/types.ts` — TypeScript types for short interest records
- `src/plugins/builtin/short-interest/client.ts` — FINRA / Yahoo short interest data client
- `src/plugins/builtin/short-interest/model.ts` — normalization, sorting, column definitions
- `src/plugins/builtin/short-interest/pane.tsx` — React pane component (chart + table)
- `src/plugins/builtin/short-interest/index.tsx` — PluginModule definition with tab + pane + shortcut

**Modify**:
- `src/plugins/builtin/ticker-detail/index.tsx` — register the short-interest tab (or add to composite)
- `src/plugins/builtin/composite-plugins.ts` — add module to `portfolioPlugin` or create a new composite
- `src/plugins/catalog-backend.ts` — add import and registration
- `src/plugins/catalog-ui.ts` — add import and registration
- `README.md` — add `SI` to command reference table

**Out of scope**:
- Real-time short interest (FINRA data is twice-monthly only; no real-time feed exists for free)
- Synthetic short interest from options put/call ratios
- Short volume (daily short sale volume from FINRA is a separate dataset)

## Git workflow

- Branch: `advisor/025-short-interest`
- Commit per file or logical unit; match repo commit style (see `git log --oneline -5`)
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Verify FINRA API

Run a test request against the FINRA short interest endpoint to confirm the response shape:

```bash
curl -s -X POST 'https://api.finra.org/data/group/otcmarket/reg/shortinterest' \
  -H 'Content-Type: application/json' \
  -d '{"symbol":"AAPL","limit":5}' | head -c 2000
```

If the endpoint is unreachable or returns an unexpected format, use the Yahoo Finance fallback: `https://query1.finance.yahoo.com/v10/finance/quoteSummary/AAPL?modules=summaryDetail,defaultKeyStatistics` and extract `shortRatio`, `shortPercentOfFloat`.

**STOP if**: Neither source returns usable short interest data. Report back with the raw response.

### Step 2: Create types

Create `src/plugins/builtin/short-interest/types.ts`:

```typescript
export interface ShortInterestRecord {
  settlementDate: Date;
  sharesShort: number;         // total shares sold short
  shortRatio: number | null;   // days to cover (shares short / avg daily volume)
  averageDailyVolume: number | null;
  shortPercentFloat: number | null;  // % of float shorted (if available)
}

export type LoadStatus = "idle" | "loading" | "loaded" | "error";
```

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 3: Create API client

Create `src/plugins/builtin/short-interest/client.ts` that:
- Fetches short interest history for a given ticker
- Uses FINRA API (POST) as primary source, Yahoo Finance quoteSummary as fallback
- Parses into `ShortInterestRecord[]` sorted by settlement date ascending
- Handles errors with clear messages
- Uses `withConnectionRequest()` on the real fetch path per AGENTS.md

Follow the pattern in `src/plugins/builtin/fear-greed/data.ts` for fetch + normalize.

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 4: Create model (sorting, columns)

Create `src/plugins/builtin/short-interest/model.ts` with:
- Column builder function (Date | Shares Short | Days to Cover | Avg Daily Vol | % Float)
- Sort function for each column (asc/desc toggle)
- Format helpers (compact number formatting for shares, ratio to 2 decimals)

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 5: Create pane component

Create `src/plugins/builtin/short-interest/pane.tsx` following the holders/insider pane pattern:
- `usePaneTicker()` to get the bound ticker
- `StockChart` for the short interest time series (shares short over time, with price overlay if available)
- `DataTableStackView` or `DataTableView` with sortable columns
- `LoadStatus` state management (idle/loading/loaded/error)
- `[r]efresh` to reload data
- `usePaneStatusFooter` for status + hints
- `EmptyState` when no data, `Spinner` while loading

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 6: Create plugin module

Create `src/plugins/builtin/short-interest/index.tsx`:

```typescript
import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";
import { ShortInterestTab } from "./pane";

export const shortInterestModule: PluginModule = {
  tickerResearchTabs: [{
    id: "short-interest",
    name: "Short Interest",
    order: 36,
    component: ShortInterestTab,
    isVisible: ({ ticker }) => !!ticker,
  }],
  panes: [{
    id: "short-interest",
    name: "Short Interest",
    icon: "S",
    component: ShortInterestTab,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 90, height: 25 },
  }],
  paneTemplates: [{
    id: "short-interest-pane",
    paneId: "short-interest",
    label: "Short Interest",
    description: "Historical short interest, days to cover, and short % of float.",
    keywords: ["short", "interest", "si", "shorts", "borrow", "days", "cover"],
    shortcut: "SI",
  }],
  setup(ctx) {
    const unregisters = [
      registerConnectionSource({
        id: "finra-short-interest",
        name: "FINRA Short Interest",
        kind: "http",
        pluginId: "short-interest",
        authRequired: false,
      }),
    ];
    return () => unregisters.forEach((fn) => fn());
  },
};
```

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 7: Register in composite plugin and catalogs

Add `shortInterestModule` to the appropriate composite plugin in `src/plugins/builtin/composite-plugins.ts` (or register directly in catalogs if standalone). Add imports to `src/plugins/catalog-backend.ts` and `src/plugins/catalog-ui.ts`.

**Verify**: `bun run typecheck` → exit 0

### Step 8: Update README

Add `SI` to the command reference table in `README.md`.

**Verify**: `bun run typecheck` → exit 0

### Step 9: TUI test

Use tmux to verify:
1. Start TUI in tmux
2. Select a ticker (e.g. AAPL)
3. Open command bar, type `SI`, Enter
4. Verify pane opens with chart and table, data loads
5. Test `[r]efresh`
6. Kill tmux session

**Verify**: Pane renders with short interest data

### Step 10: Full verification

**Verify**: `bun run typecheck` → exit 0, `bun test` → all pass

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun test` exits 0
- [ ] `SI` shortcut opens the pane in the TUI
- [ ] Short interest data loads from FINRA or Yahoo fallback
- [ ] Columns are sortable (click header)
- [ ] `[r]efresh` reloads data
- [ ] Connection source registered (shows in Connections pane)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Neither FINRA nor Yahoo returns usable short interest data — report the raw API responses.
- The FINRA API requires authentication or has CORS restrictions that block direct fetch — if so, add a cloud proxy endpoint (out of scope; report back).
- The `StockChart` API doesn't support the dual-series (shares + price) overlay needed — simplify to a single-series shares-short chart.

## Maintenance notes

- FINRA may change their API structure. The parser should handle missing fields gracefully.
- Yahoo Finance quoteSummary provides point-in-time short ratio, not historical. For historical, FINRA is the only free source.
- If short interest proves popular, consider adding short volume (daily short sale volume) as a separate tab.
