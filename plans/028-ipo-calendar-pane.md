# Plan 028: Add IPO Calendar pane

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3381ada..HEAD -- src/plugins/builtin/econ/ src/plugins/builtin/congress-trades/`
> If the econ or congress-trades pattern has changed significantly, treat as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: godel-parity
- **Planned at**: commit `3381ada`, 2026-08-17

## Why this matters

IPO calendars with pricing, exchange, underwriters, and post-listing performance are a standard terminal function (Godel's `IPO`). Gloom has SEC filings and earnings calendar but no IPO tracking. SEC EDGAR S-1 filings are free and public, and Yahoo Finance / stockanalysis.com provide IPO calendars and post-listing performance data, making this feasible without paid feeds.

## Godel reference

- **Command**: `IPO` (Initial Public Offerings)
- **Docs**: https://godelterminal.com/docs/commands/ipo.html
- **Function**: Upcoming and recent IPOs with columns: Ticker, Date, Status (upcoming/priced/trading), Exchange, Offer Size, Price, Shares, Open, Close, Volume, 1D/1W/1M performance %. Upcoming rows tinted. Row click opens SEC S-1 prospectus. Excel export. 100 rows per page.

## Current state

**Existing patterns to follow:**

1. **Econ calendar pane** (`src/plugins/builtin/econ/`) — calendar-style tabular data with date-ordered rows, filters, sortable columns, `[r]efresh`. This is the closest structural pattern.

2. **Congress trades pane** (`src/plugins/builtin/congress-trades/`) — tabular data with clickable rows that open external links (SEC filings), sortable columns, detail view.

3. **SEC plugin** (`src/plugins/builtin/sec/`) — already fetches SEC EDGAR data. The IPO pane can reuse SEC EDGAR's S-1 filing search for the "upcoming" pipeline.

**Data source:**

Primary: stockanalysis.com IPO calendar (free, scraped JSON endpoint):
- URL: `https://stockanalysis.com/ipos/` (HTML page, but has a JSON data endpoint at `https://stockanalysis.com/api/symbol/v1/...` or similar)
- Alternative: Yahoo Finance IPO calendar: `https://finance.yahoo.com/calendar/ipo`
- For S-1 filings (upcoming pipeline): SEC EDGAR full-text search: `https://efts.sec.gov/LATEST/search-index?q=%22S-1%22&dateRange=custom&startdt=...&enddt=...&forms=S-1`

**Important**: Verify which free source provides the most reliable IPO data. stockanalysis.com is the most structured free source but may require HTML scraping. Yahoo Finance's IPO calendar is JSON-backed but may have CORS restrictions. Test all candidates before committing to one.

**Fallback approach**: Use SEC EDGAR S-1 filing dates as the "upcoming IPOs" source (completely free, no scraping needed) and Yahoo Finance daily gainers for "recently priced" performance. This avoids any HTML scraping.

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
- `src/plugins/builtin/ipo-calendar/types.ts` — TypeScript types for IPO records
- `src/plugins/builtin/ipo-calendar/client.ts` — IPO data client (SEC EDGAR + Yahoo/stockanalysis)
- `src/plugins/builtin/ipo-calendar/model.ts` — normalization, status computation, performance calc, column definitions
- `src/plugins/builtin/ipo-calendar/pane.tsx` — React pane component
- `src/plugins/builtin/ipo-calendar/index.tsx` — PluginModule definition with pane + shortcut

**Modify**:
- `src/plugins/builtin/composite-plugins.ts` — add module to `macroPlugin`
- `src/plugins/catalog-backend.ts` — add import and registration
- `src/plugins/catalog-ui.ts` — add import and registration
- `README.md` — add `IPO` to command reference table

**Out of scope**:
- SPAC merger tracking (separate data source)
- Direct listings vs traditional IPOs distinction
- Underwriter syndicate details (not available in free feeds)
- Real-time IPO pricing alerts

## Git workflow

- Branch: `advisor/028-ipo-calendar`
- Commit per file or logical unit; match repo commit style
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Verify data sources

Test candidate endpoints:

```bash
# SEC EDGAR S-1 filings (most reliable for upcoming)
curl -s 'https://efts.sec.gov/LATEST/search-index?q=%22S-1%22&forms=S-1&dateRange=custom&startdt=2026-08-01&enddt=2026-08-31' -H 'User-Agent: Gloomberb research@gloomberb.com' | head -c 2000

# stockanalysis.com IPO data
curl -s 'https://stockanalysis.com/ipos/' -H 'User-Agent: Mozilla/5.0' | head -c 2000

# Yahoo Finance IPO calendar
curl -s 'https://finance.yahoo.com/calendar/ipo' -H 'User-Agent: Mozilla/5.0' | head -c 2000
```

**STOP if**: No source returns usable IPO data. Report the raw responses and recommend the best approach.

### Step 2: Create types

Create `src/plugins/builtin/ipo-calendar/types.ts`:

```typescript
export type IPOStatus = "upcoming" | "priced" | "trading" | "withdrawn";

export interface IPORecord {
  ticker: string;
  companyName: string;
  date: Date;               // offering or expected date
  status: IPOStatus;
  exchange: string | null;
  offerSize: number | null;  // total offering size in USD
  priceRange: [number, number] | null;  // expected price range
  pricedPrice: number | null;  // final offer price
  shares: number | null;
  openPrice: number | null;    // first-day open
  closePrice: number | null;   // first-day close
  volume: number | null;       // first-day volume
  change1D: number | null;     // first-day performance %
  change1W: number | null;     // first-week performance %
  change1M: number | null;     // first-month performance %
  secUrl: string | null;       // S-1 prospectus link
}

export type LoadStatus = "idle" | "loading" | "loaded" | "error";
```

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 3: Create API client

Create `src/plugins/builtin/ipo-calendar/client.ts` that:
- Fetches recent and upcoming IPOs from the best verified source
- For upcoming IPOs: searches SEC EDGAR for recent S-1/S-1-A filings
- For priced/trading IPOs: fetches from the IPO calendar source
- Enriches with first-day performance from Yahoo Finance quote data
- Parses into `IPORecord[]` sorted by date descending
- Uses `withConnectionRequest()` on the real fetch path
- Handles errors with clear messages

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 4: Create model (status, performance, columns)

Create `src/plugins/builtin/ipo-calendar/model.ts` with:
- `computeStatus(record)`: determines upcoming/priced/trading from dates and price availability
- Column builder (Ticker | Date | Status | Exchange | Offer | Price | Shares | Open | Close | Chg 1D | Chg 1W | Chg 1M)
- Sort function for each column (asc/desc toggle)
- Format helpers (offer size K/M/B, performance % with color)

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 5: Create pane component

Create `src/plugins/builtin/ipo-calendar/pane.tsx` following the econ calendar pattern:
- `DataTableStackView` with sortable columns
- Upcoming rows tinted with a subtle background (use `colors` from components)
- `LoadStatus` state management (idle/loading/loaded/error)
- `[r]efresh` to reload, `[s]` search/filter when list is long
- `usePaneStatusFooter` for status + hints
- `EmptyState` when no IPOs, `Spinner` while loading
- Click row to open SEC S-1 filing (`openUrl(record.secUrl)`) if available, or open ticker in research pane
- Performance columns color-coded green/red using `priceColor()`

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 6: Create plugin module

Create `src/plugins/builtin/ipo-calendar/index.tsx`:

```typescript
import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";

export const ipoCalendarModule: PluginModule = {
  panes: [{
    id: "ipo-calendar",
    name: "IPO Calendar",
    icon: "I",
    component: IPOCalendarPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 110, height: 28 },
  }],
  paneTemplates: [{
    id: "ipo-calendar-pane",
    paneId: "ipo-calendar",
    label: "IPO Calendar",
    description: "Upcoming and recent IPOs with pricing, performance, and S-1 links.",
    keywords: ["ipo", "initial", "public", "offering", "s-1", "prospectus", "new", "listing", "debut"],
    shortcut: { prefix: "IPO" },
  }],
  setup(ctx) {
    const unregisters = [
      registerConnectionSource({
        id: "sec-edgar-ipo",
        name: "SEC EDGAR (IPO Filings)",
        kind: "http",
        pluginId: "ipo-calendar",
        authRequired: false,
      }),
    ];
    return () => unregisters.forEach((fn) => fn());
  },
};
```

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 7: Register in composite plugin and catalogs

Add `ipoCalendarModule` to `macroPlugin` in `src/plugins/builtin/composite-plugins.ts`. Add imports to `src/plugins/catalog-backend.ts` and `src/plugins/catalog-ui.ts`.

**Verify**: `bun run typecheck` → exit 0

### Step 8: Update README

Add `IPO` to the command reference table in `README.md`.

**Verify**: `bun run typecheck` → exit 0

### Step 9: TUI test

Use tmux to verify:
1. Start TUI in tmux
2. Open command bar, type `IPO`, Enter
3. Verify pane opens with IPO table
4. Verify data loads and columns are sortable
5. Test `[r]efresh` and `[s]`earch
6. Kill tmux session

**Verify**: Pane renders with IPO data

### Step 10: Full verification

**Verify**: `bun run typecheck` → exit 0, `bun test` → all pass

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun test` exits 0
- [ ] `IPO` shortcut opens the pane in the TUI
- [ ] IPO data loads from SEC EDGAR and/or IPO calendar source
- [ ] Columns are sortable (click header)
- [ ] `[s]`earch filters the list
- [ ] Upcoming rows are tinted
- [ ] Click row opens S-1 filing or ticker research
- [ ] Performance columns are color-coded
- [ ] `[r]efresh` reloads data
- [ ] Connection source registered (shows in Connections pane)
- [ ] `plans/README.md` status row updated

## STOP conditions

- No free source returns usable IPO calendar data — report the raw responses from all tested endpoints.
- The best available source requires HTML scraping that is too fragile — consider using only SEC EDGAR S-1 filings for upcoming IPOs and skip the post-listing performance columns.
- CORS blocks direct fetch from the hosted web client — add a cloud proxy endpoint (out of scope; report back).

## Maintenance notes

- IPO data sources are notoriously unreliable. SEC EDGAR S-1 filings are the most stable free source for upcoming IPOs.
- Post-listing performance requires price data that may not be available on day one. Handle gracefully with null values.
- Consider adding a filter for exchange (NASDAQ/NYSE) and offer size range as future enhancements.
