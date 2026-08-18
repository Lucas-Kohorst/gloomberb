# Plan 022: Add Treasury auctions pane

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat b9d938f..HEAD -- src/plugins/builtin/econ/ src/plugins/catalog-backend.ts src/plugins/catalog-ui.ts`
> If the directory structure has changed significantly, treat as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW/MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `b9d938f`, 2026-08-17

## Why this matters

Treasury auction schedules, bid-to-cover ratios, indirect awards, and tails directly explain Treasury curve moves and are highly actionable around auction time. The app already has a yield curve pane (Treasury rates from FRED) but no auction data. Treasury Fiscal Data is a free public API with no authentication required, making this the lowest-risk alt-data feature to add.

## Current state

**Existing patterns to follow:**

1. **Econ calendar pane** (`src/plugins/builtin/econ/`) — fetches economic calendar data from the cloud API, normalizes into typed events, displays in `DataTableStackView` with date separators, filters, and `[r]efresh`. This is the closest pattern: tabular data with dates, sortable columns, and a detail view.

2. **Yield curve pane** (`src/plugins/builtin/yield-curve/`) — simpler pattern: fetch from cloud API, display chart + table, `[r]efresh` shortcut, status footer.

3. **Congress trades pane** (`src/plugins/builtin/congress-trades/`) — cloud-backed tabular data with sortable columns, detail view, and footer hints. Good model for the table + detail pattern.

**Data source:**

Treasury Fiscal Data API — public, no auth:
- Auction query: `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query`
- Parameters: `fields=`, `filter=`, `sort=`, `page[size]=`, `page[number]=`
- Returns JSON with `data` array of auction records
- Key fields: `sec_type`, `security_term`, `security_term_length`, `auction_date`, `high_investment_rate`, `high_price`, `low_price`, `median_price`, `competitive_tenders_accepted`, `indirect_tenders_accepted`, `total_tenders_accepted`, `bid_to_cover_ratio`

**Plugin registration:**

Plugins are registered in:
- `src/plugins/catalog-backend.ts` — backend (desktop) plugin list
- `src/plugins/catalog-ui.ts` — UI (renderer) plugin list

Each entry imports the module and adds it to the array.

**Pane footer pattern:**

Use `usePaneStatusFooter` from `src/plugins/builtin/shared/pane-footer.ts` for status (loading/error/stale) and action hints. Follow AGENTS.md: footers show only status that can change plus action hints. Use `[r]efresh` for network-backed data.

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
- `src/plugins/builtin/treasury-auctions/types.ts` — TypeScript types for auction records
- `src/plugins/builtin/treasury-auctions/client.ts` — Treasury Fiscal Data API client
- `src/plugins/builtin/treasury-auctions/model.ts` — normalization, sorting, column definitions
- `src/plugins/builtin/treasury-auctions/pane.tsx` — React pane component
- `src/plugins/builtin/treasury-auctions/index.tsx` — GloomPlugin definition with pane + shortcut

**Modify**:
- `src/plugins/catalog-backend.ts` — add import and registration
- `src/plugins/catalog-ui.ts` — add import and registration
- `README.md` — add shortcut to command reference table

**Out of scope**:
- Cloud backend proxy — the Treasury Fiscal Data API is public and supports CORS; fetch directly from the client. If CORS is an issue in the hosted web client, add a cloud proxy endpoint later.
- Historical auction analysis or charts — start with a sortable table only.
- TreasuryDirect auction announcements — use the auctions_query endpoint only for now.

## Git workflow

- Branch: `advisor/022-treasury-auctions`
- Commit per file or logical unit; match repo commit style (see `git log --oneline -5`)
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Create types

Create `src/plugins/builtin/treasury-auctions/types.ts` with:

```typescript
export interface TreasuryAuction {
  id: string;            // sec_type + auction_date + security_term
  secType: string;       // "Bill", "Note", "Bond", "CMB", "FRN", "TIPS"
  securityTerm: string;  // "4-Week", "8-Week", "2-Year", "10-Year", etc.
  auctionDate: Date;
  highInvestmentRate: number | null;
  highPrice: number | null;
  lowPrice: number | null;
  medianPrice: number | null;
  bidToCoverRatio: number | null;
  competitiveAccepted: number | null;
  indirectAccepted: number | null;  // indirect tenders (foreign central banks)
  totalAccepted: number | null;
}

export type LoadStatus = "idle" | "loading" | "loaded" | "error";

export interface AuctionColumn {
  id: "date" | "type" | "term" | "rate" | "btc" | "indirect";
  label: string;
  width: number;
  align: "left" | "right";
}
```

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 2: Create API client

Create `src/plugins/builtin/treasury-auctions/client.ts` that:
- Fetches from `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query`
- Requests `fields=` for only the columns needed
- Requests recent auctions: `filter=auction_date:gte:` with a date 30 days ago, sorted by `auction_date:desc`
- Parses the JSON `data` array into `TreasuryAuction[]`
- Handles errors with clear messages

Follow the pattern in `src/plugins/builtin/fear-greed/data.ts` for fetch + normalize, but simpler since the API returns clean JSON.

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 3: Create model (sorting, columns)

Create `src/plugins/builtin/treasury-auctions/model.ts` with:
- Column builder function (like `buildTradeColumns` in congress-trades/model.ts)
- Sort function for each column (asc/desc toggle)
- Any filter helpers (by security type: Bills/Notes/Bonds/All)

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 4: Create pane component

Create `src/plugins/builtin/treasury-auctions/pane.tsx` following the congress-trades pane pattern:
- `DataTableStackView` with sortable columns
- `LoadStatus` state management (idle/loading/loaded/error)
- Generation counter for race condition prevention (see `fetchGenRef` pattern in econ pane)
- `[r]efresh` to reload, `[f]` to cycle security type filter
- `usePaneStatusFooter` for status + hints
- `EmptyState` when no data
- `Spinner` while loading
- Error display

Columns: Date | Type | Term | Rate | BTC | Indirect%

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 5: Create plugin definition

Create `src/plugins/builtin/treasury-auctions/index.tsx`:

```typescript
import type { PluginModule } from "../plugin-module";
import { treasuryAuctionsPane } from "./pane";

export const treasuryAuctionsModule: PluginModule = {
  panes: [{
    id: "treasury-auctions",
    name: "Treasury Auctions",
    icon: "A",
    component: TreasuryAuctionsPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 90, height: 25 },
  }],
  paneTemplates: [{
    id: "treasury-auctions-pane",
    paneId: "treasury-auctions",
    label: "Treasury Auctions",
    description: "Recent and upcoming Treasury auction results.",
    keywords: ["treasury", "auction", "bonds", "bills", "notes", "bid", "cover", "indirect"],
    shortcut: { prefix: "AUCT" },
  }],
  setup(ctx) {
    // Register connection source per AGENTS.md guidelines
    const unregisters = [
      registerConnectionSource({
        id: "treasury-fiscal-data",
        name: "Treasury Fiscal Data",
        kind: "http",
        pluginId: "treasury-auctions",
        authRequired: false,
      }),
    ];
    return () => unregisters.forEach((fn) => fn());
  },
};
```

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 6: Register in catalogs

Add to `src/plugins/catalog-backend.ts`:
```typescript
import { treasuryAuctionsModule } from "./builtin/treasury-auctions";
// Add to the backend plugins array
```

Add to `src/plugins/catalog-ui.ts`:
```typescript
import { treasuryAuctionsModule } from "./builtin/treasury-auctions";
// Add to the UI plugins array
```

**Verify**: `bun run typecheck` → exit 0

### Step 7: Update README

Add `AUCT` to the command reference table in `README.md`, following the pattern of other shortcuts.

**Verify**: `bun run typecheck` → exit 0

### Step 8: TUI test

Use tmux to verify the pane renders:
1. Start TUI in tmux
2. Open command bar (Ctrl+P)
3. Type `AUCT` and Enter
4. Verify pane opens with table headers and data loads
5. Kill tmux session

**Verify**: Pane renders with auction data, `[r]efresh` works

### Step 9: Full verification

**Verify**: `bun run typecheck` → exit 0, `bun test` → all pass

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun test` exits 0
- [ ] `AUCT` shortcut opens the pane in the TUI
- [ ] Auction data loads from Treasury Fiscal Data API
- [ ] Columns are sortable (click header)
- [ ] `[r]efresh` reloads data
- [ ] Connection source registered (shows in Connections pane)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The Treasury Fiscal Data API returns an unexpected schema — inspect the raw JSON response and adjust the parser.
- CORS blocks direct fetch from the hosted web client — if so, add a cloud proxy endpoint (out of scope for this plan; report back).
- The `DataTableStackView` API doesn't match what's described — read `src/plugins/builtin/congress-trades/pane.tsx` for the correct API.

## Maintenance notes

- The Treasury Fiscal Data API may change field names or add new security types. The parser should handle unknown fields gracefully (skip, don't crash).
- If auction data proves popular, consider adding a detail view with bid distribution charts.
- The API has rate limits (undocumented but generous) — the 24h cache window in the client should be sufficient.
