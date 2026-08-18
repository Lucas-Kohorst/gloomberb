# Plan 026: Add Dividend Yield pane

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3381ada..HEAD -- src/plugins/builtin/research/ src/plugins/builtin/ticker-detail/`
> If the research/ticker-detail pattern has changed significantly, treat as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: godel-parity
- **Planned at**: commit `3381ada`, 2026-08-17

## Why this matters

Dividend yield is a core equity analysis function in every Bloomberg-style terminal (Godel's `DVD`). It shows trailing/forward yield, dividend growth rates, ex-dividend dates, and a full dividend payment history table. Gloom's corporate-actions tab (`EVT`) mentions dividends but does not provide a dedicated dividend yield view with yield chart, growth metrics, or payment history. This is high-value for income-oriented investors and costs nothing — Yahoo Finance provides dividend history for free.

## Godel reference

- **Command**: `DVD` (Dividend Yield)
- **Docs**: https://godelterminal.com/docs/commands/dvd.html
- **Function**: Dividend metrics (12-month yield, indicated/forward yield, 1yr/3yr dividend growth, payment frequency), interactive yield chart over time, dividend history table (declaration, ex-date, record date, payable date, currency, amount, type).

## Current state

**Existing patterns to follow:**

1. **Corporate actions tab** (`src/plugins/builtin/research/`) — `EVT` shortcut. Shows dividends, splits, earnings. The `CorporateActionsView` component already fetches some corporate action data. This new pane complements it with a dedicated dividend focus.

2. **Historical prices pane** (`src/plugins/builtin/ticker-detail/data-panes/historical-prices.tsx`) — per-ticker chart + table with date range. Good model for the yield chart + payment table layout.

3. **Yield curve pane** (`src/plugins/builtin/yield-curve/`) — chart + table with `[r]efresh`. The yield chart concept is similar.

**Data source:**

Yahoo Finance — public, no auth (already used by Gloom's Yahoo plugin):
- Dividend history: `https://query1.finance.yahoo.com/v7/finance/download/AAPL?period1=...&period2=...&interval=1mo&events=div`
  Returns CSV: Date,Dividends
- Quote summary for yield/growth: `https://query1.finance.yahoo.com/v10/finance/quoteSummary/AAPL?modules=summaryDetail,financialData,defaultKeyStatistics`
  Returns: `dividendRate`, `trailingAnnualDividendYield`, `forwardAnnualDividendRate`, `payoutRatio`, `exDividendDate`, `dividendDate`

**Plugin registration:**

Follow the `createTickerSurfacePaneTemplate` pattern for ticker-scoped panes. Register as both a Ticker Research tab and a standalone pane.

**Connections registration:**

Register Yahoo Finance as a connection source (may already be registered by the Yahoo plugin — check `src/plugins/builtin/yahoo/` first and reuse the existing source ID).

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Typecheck | `bun run typecheck:opentui`      | exit 0              |
| Full TC   | `bun run typecheck`              | exit 0              |
| Tests     | `bun test`                       | all pass            |
| TUI test  | tmux session (see tui-testing skill) | pane renders     |

## Scope

**In scope** (create these files):
- `src/plugins/builtin/dividend-yield/types.ts` — TypeScript types for dividend records and metrics
- `src/plugins/builtin/dividend-yield/client.ts` — Yahoo Finance dividend data client
- `src/plugins/builtin/dividend-yield/model.ts` — yield computation, growth rates, column definitions
- `src/plugins/builtin/dividend-yield/pane.tsx` — React pane component (metrics + yield chart + payment table)
- `src/plugins/builtin/dividend-yield/index.tsx` — PluginModule definition with tab + pane + shortcut

**Modify**:
- `src/plugins/builtin/composite-plugins.ts` — add module to `portfolioPlugin` or `marketOverviewPlugin`
- `src/plugins/catalog-backend.ts` — add import and registration
- `src/plugins/catalog-ui.ts` — add import and registration
- `README.md` — add `DVD` to command reference table

**Out of scope**:
- Dividend reinvestment plan (DRIP) calculations
- Dividend safety scoring (requires payout ratio trends, FCF coverage)
- Special dividend filtering (show type column but no separate views)

## Git workflow

- Branch: `advisor/026-dividend-yield`
- Commit per file or logical unit; match repo commit style
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Create types

Create `src/plugins/builtin/dividend-yield/types.ts`:

```typescript
export interface DividendPayment {
  exDate: Date;
  recordDate: Date | null;
  paymentDate: Date | null;
  declarationDate: Date | null;
  amount: number;
  currency: string;
  type: "cash" | "special" | "stock" | "unknown";
}

export interface DividendMetrics {
  trailingYield: number | null;      // 12-month dividend / current price
  forwardYield: number | null;       // indicated annual rate / current price
  trailingRate: number | null;       // trailing 12-month dividend per share
  forwardRate: number | null;        // most recent annualized rate
  payoutRatio: number | null;
  growth1Y: number | null;           // YoY dividend growth %
  growth3Y: number | null;           // 3yr annualized dividend growth %
  paymentFrequency: "monthly" | "quarterly" | "semi-annual" | "annual" | "irregular" | null;
  exDividendDate: Date | null;
  nextPayDate: Date | null;
}

export type LoadStatus = "idle" | "loading" | "loaded" | "error";
```

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 2: Create API client

Create `src/plugins/builtin/dividend-yield/client.ts` that:
- Fetches dividend history via Yahoo Finance download endpoint (CSV)
- Fetches quoteSummary for current yield/rate/payout/ex-dividend fields
- Parses CSV into `DividendPayment[]` sorted by ex-date descending
- Computes `DividendMetrics` from the payment history + quote summary
- Uses `withConnectionRequest()` on the real fetch path
- Handles errors with clear messages

Follow the pattern in `src/plugins/builtin/fear-greed/data.ts`.

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 3: Create model (yield computation, columns)

Create `src/plugins/builtin/dividend-yield/model.ts` with:
- `computeTrailingYield(payments, currentPrice)` — sum of dividends in trailing 12 months / price
- `computeGrowthRates(payments)` — 1yr and 3yr annualized growth from payment amounts
- `inferFrequency(payments)` — detect monthly/quarterly/etc from payment spacing
- Column builder for the dividend history table (Ex Date | Pay Date | Amount | Type | Currency)
- Sort function for each column (asc/desc toggle)

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 4: Create pane component

Create `src/plugins/builtin/dividend-yield/pane.tsx` following the historical-prices pane pattern:
- `usePaneTicker()` to get the bound ticker
- **Top section**: Dividend metrics rows (Trailing Yield, Forward Yield, 1Y Growth, 3Y Growth, Payout Ratio, Frequency, Ex-Date, Next Pay Date)
- **Middle section**: `StockChart` showing dividend yield over time (compute rolling 12-month yield at each payment date)
- **Bottom section**: `DataTableView` with sortable dividend history table
- `LoadStatus` state management
- `[r]efresh` to reload
- `usePaneStatusFooter` for status + hints
- `EmptyState` when no dividends (non-dividend payers), `Spinner` while loading

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 5: Create plugin module

Create `src/plugins/builtin/dividend-yield/index.tsx`:

```typescript
import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";

export const dividendYieldModule: PluginModule = {
  tickerResearchTabs: [{
    id: "dividend-yield",
    name: "Dividends",
    order: 38,
    component: DividendYieldTab,
    isVisible: ({ ticker }) => !!ticker,
  }],
  panes: [{
    id: "dividend-yield",
    name: "Dividend Yield",
    icon: "D",
    component: DividendYieldTab,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 90, height: 28 },
  }],
  paneTemplates: [{
    id: "dividend-yield-pane",
    paneId: "dividend-yield",
    label: "Dividend Yield",
    description: "Dividend history, trailing/forward yield, growth rates, and payment schedule.",
    keywords: ["dividend", "yield", "dvd", "income", "payout", "ex-date", "distribution"],
    shortcut: "DVD",
  }],
  setup(ctx) {
    // Check if Yahoo is already registered; reuse if so
    const unregisters = [
      registerConnectionSource({
        id: "yahoo-dividends",
        name: "Yahoo Finance (Dividends)",
        kind: "http",
        pluginId: "dividend-yield",
        authRequired: false,
      }),
    ];
    return () => unregisters.forEach((fn) => fn());
  },
};
```

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 6: Register in composite plugin and catalogs

Add `dividendYieldModule` to `portfolioPlugin` or `marketOverviewPlugin` in `src/plugins/builtin/composite-plugins.ts`. Add imports to `src/plugins/catalog-backend.ts` and `src/plugins/catalog-ui.ts`.

**Verify**: `bun run typecheck` → exit 0

### Step 7: Update README

Add `DVD` to the command reference table in `README.md`.

**Verify**: `bun run typecheck` → exit 0

### Step 8: TUI test

Use tmux to verify:
1. Start TUI in tmux
2. Select a dividend-paying ticker (e.g. KO, AAPL)
3. Open command bar, type `DVD`, Enter
4. Verify pane opens with metrics, yield chart, and payment table
5. Test `[r]efresh`
6. Kill tmux session

**Verify**: Pane renders with dividend data

### Step 9: Full verification

**Verify**: `bun run typecheck` → exit 0, `bun test` → all pass

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun test` exits 0
- [ ] `DVD` shortcut opens the pane in the TUI
- [ ] Dividend data loads from Yahoo Finance
- [ ] Yield chart renders for dividend-paying tickers
- [ ] Payment history table is sortable (click header)
- [ ] Metrics show trailing yield, forward yield, growth rates
- [ ] `EmptyState` shown for non-dividend payers
- [ ] `[r]efresh` reloads data
- [ ] Connection source registered (shows in Connections pane)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Yahoo Finance blocks dividend CSV download (CORS or rate limiting) — if so, add a cloud proxy endpoint (out of scope; report back).
- The Yahoo quoteSummary API doesn't return dividend fields for non-US tickers — handle gracefully with `EmptyState`.

## Maintenance notes

- Yahoo Finance may change the dividend download URL or response format. The CSV parser should be resilient to extra columns.
- Growth rate computation depends on consistent payment frequency. For irregular payers, fall back to null rather than computing misleading growth.
- If a reliable free source for ex-dividend calendars becomes available, consider adding an upcoming dividends list.
