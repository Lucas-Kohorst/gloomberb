# Plan 024: Add corporate and municipal bond search pane

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat b9d938f..HEAD -- src/plugins/builtin/yield-curve/ src/plugins/builtin/congress-trades/ src/api-client/ src/plugins/catalog-backend.ts`
> If the directory structure has changed significantly, treat as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: none (but plan 022 Treasury auctions is complementary)
- **Category**: direction
- **Planned at**: commit `b9d938f`, 2026-08-17

## Why this matters

The app has a Treasury yield curve pane but no way to search or browse corporate or municipal bonds. This is the major missing fixed-income workflow. Users cannot discover corporate instruments, compare credit spreads, or inspect individual bond liquidity. This plan builds a bond search pane that shows aggregate corporate yield indices from FRED (immediate, no auth) and lays the groundwork for individual bond search via FINRA TRACE and MSRB EMMA (requiring API verification).

## Current state

**Existing patterns:**

1. **Congress trades pane** (`src/plugins/builtin/congress-trades/`) — cloud-backed tabular data with search, sortable columns, and detail view. This is the model for bond search results.

2. **Yield curve pane** (`src/plugins/builtin/yield-curve/`) — FRED data fetch via `apiClient.getCloudYieldCurve()`, chart rendering with `StaticChartSurface`. The yield-curve data path is: client → `apiClient` → cloud API → FRED.

3. **FRED series system** (`src/data/fred-series.ts`) — generic FRED series fetcher with caching and persistence. Already used by the econ plugin. Can be reused for corporate yield indices.

4. **API client** (`src/api-client/data.ts`) — typed cloud data methods. New bond data methods would follow the same pattern: `apiClient.getCloudBondSearch(query)` etc.

5. **Cloud backend** (`src/renderers/cloudflare/backend.ts`) — handles RPC dispatch. New bond data endpoints would be added here.

**FRED corporate bond yield indices (public, no auth, already accessible via existing FRED integration):**

- `BAMLC0A0CM` — ICE BofA US Corporate Index yield (all-rated)
- `BAMLH0A0HYM` — ICE BofA US High Yield Index yield
- `BAMLC0A4CBBB` — ICE BofA BBB Corporate yield
- `BAMLC0A1CAAA` — ICE BofA AAA Corporate yield
- `BAMLEM0YYCRA` — ICE BofA EM Corporate yield
- `BAMLC0A0C13Y` — ICE BofA 1-3Y Corporate yield
- `BAMLC0A0C510Y` — ICE BofA 5-10Y Corporate yield

These can be fetched immediately via the existing FRED series system and displayed as aggregate corporate yield curves by rating and maturity.

**FINRA TRACE (corporate bond trades — requires registration):**

- FINRA TRACE API: `https://api.finra.org/data/group/OTCMarket/groups/FixedIncome/markets/Bonds`
- Requires OAuth client credentials (free developer registration)
- Returns trade-level data: CUSIP, issuer, trade date, price, yield, size
- **Risk**: requires API key management, rate limits, and redistribution terms verification

**MSRB EMMA (municipal bond data — public):**

- EMMA provides municipal security data and trade reports
- Public access via `https://emma.msrb.org/MarketData/MarketDataHome`
- No official REST API, but data is publicly accessible
- **Risk**: no machine-readable API; may require scraping or manual data entry

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Typecheck | `bun run typecheck:opentui`      | exit 0              |
| Full TC   | `bun run typecheck`              | exit 0              |
| Tests     | `bun test`                       | all pass            |
| TUI test  | tmux session                     | pane renders        |

## Scope

**Phase 1 — FRED corporate yield indices (in scope, immediate):**

Create:
- `src/plugins/builtin/bond-search/types.ts` — types for bond yields, search results
- `src/plugins/builtin/bond-search/fred-yields.ts` — FRED corporate yield series fetcher
- `src/plugins/builtin/bond-search/model.ts` — column definitions, sorting, spread calculation
- `src/plugins/builtin/bond-search/pane.tsx` — React pane with yield table + search bar
- `src/plugins/builtin/bond-search/index.tsx` — GloomPlugin definition

Modify:
- `src/plugins/catalog-backend.ts` — register
- `src/plugins/catalog-ui.ts` — register
- `README.md` — add shortcut

**Phase 2 — Individual bond search (in scope as scaffold, STOP if API issues):**

Create:
- `src/plugins/builtin/bond-search/client.ts` — search client (FINRA TRACE / EMMA)

Modify:
- `src/api-client/data.ts` — add `getCloudBondSearch` method
- `src/api-client/paths.ts` — add bond search path
- `src/renderers/cloudflare/backend.ts` — add bond search RPC handler

**Out of scope:**
- Municipal bond trade data (EMMA has no REST API; requires separate data sourcing effort)
- Bond detail view with full trade history (Phase 3)
- Bond calculator / yield-to-maturity (Phase 3)
- Chart composer integration (separate enhancement)

## Git workflow

- Branch: `advisor/024-bond-search`
- Commit per step
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Create types

Create `src/plugins/builtin/bond-search/types.ts`:

```typescript
export interface CorporateYieldEntry {
  seriesId: string;       // "BAMLC0A0CM", "BAMLH0A0HYM", etc.
  label: string;          // "IG All-Rated", "High Yield", "BBB", "AAA"
  rating: string;         // "AAA", "BBB", "HY", "IG"
  maturityRange: string;  // "1-3Y", "5-10Y", "All"
  yield: number | null;   // percent
  updatedAt: Date | null;
}

export interface BondSearchResult {
  cusip: string;
  issuer: string;
  securityType: string;    // "Corporate", "Municipal", "Treasury"
  coupon: number | null;
  maturityDate: Date | null;
  rating: string | null;   // "AA+", "BBB-", etc.
  lastPrice: number | null;
  lastYield: number | null;
  lastTradeDate: Date | null;
}

export type LoadStatus = "idle" | "loading" | "loaded" | "error";

export type BondTab = "yields" | "search";

export interface YieldColumn {
  id: "label" | "rating" | "maturity" | "yield" | "spread";
  label: string;
  width: number;
  align: "left" | "right";
}

export interface SearchColumn {
  id: "issuer" | "cusip" | "coupon" | "maturity" | "rating" | "yield";
  label: string;
  width: number;
  align: "left" | "right";
}
```

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 2: Create FRED corporate yields fetcher

Create `src/plugins/builtin/bond-search/fred-yields.ts`:
- Define the list of FRED corporate yield series IDs with metadata (label, rating, maturity range)
- Fetch each via `loadCachedFredSeries` from `src/data/fred-series.ts`
- Extract latest value and date for each
- Compute spread vs. matched Treasury yield (from existing yield-curve data)
- Return `CorporateYieldEntry[]`

FRED series to fetch:
```typescript
const CORPORATE_SERIES = [
  { seriesId: "BAMLC0A1CAAA", label: "IG AAA", rating: "AAA", maturityRange: "All" },
  { seriesId: "BAMLC0A2A", label: "IG AA", rating: "AA", maturityRange: "All" },
  { seriesId: "BAMLC0A3A", label: "IG A", rating: "A", maturityRange: "All" },
  { seriesId: "BAMLC0A4CBBB", label: "IG BBB", rating: "BBB", maturityRange: "All" },
  { seriesId: "BAMLC0A0CM", label: "IG All-Rated", rating: "IG", maturityRange: "All" },
  { seriesId: "BAMLH0A0HYM", label: "High Yield", rating: "HY", maturityRange: "All" },
  { seriesId: "BAMLC0A0C13Y", label: "IG 1-3Y", rating: "IG", maturityRange: "1-3Y" },
  { seriesId: "BAMLC0A0C510Y", label: "IG 5-10Y", rating: "IG", maturityRange: "5-10Y" },
];
```

Use `attachFredSeriesPersistence` in the plugin's `setup()` (same as econ plugin).

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 3: Create model

Create `src/plugins/builtin/bond-search/model.ts`:
- Yield column builder
- Search column builder
- Sort functions for each column
- Spread calculation (corporate yield - matched Treasury yield)

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 4: Create pane component (yields tab)

Create `src/plugins/builtin/bond-search/pane.tsx`:
- Two tabs: "Yields" and "Search" (use `Tabs` component from shared UI)
- **Yields tab**: `DataTableStackView` showing corporate yield indices with columns: Label | Rating | Maturity | Yield | Spread vs Treasury
- **Search tab**: `InputSearchBar` + `DataTableStackView` for bond search results (Phase 2 — start with empty state "Search for bonds by issuer or CUSIP")
- `[r]efresh` to reload yields
- `[s]earch` or `/` to focus search bar on search tab
- `usePaneStatusFooter` for status + hints
- Loading/error/empty states
- Generation counter for race condition prevention

Follow the congress-trades pane pattern for the table, and the polls pane pattern for the search bar.

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 5: Create plugin definition

Create `src/plugins/builtin/bond-search/index.tsx`:

```typescript
export const bondSearchModule: PluginModule = {
  panes: [{
    id: "bond-search",
    name: "Bond Search",
    icon: "B",
    component: BondSearchPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 100, height: 30 },
  }],
  paneTemplates: [{
    id: "bond-search-pane",
    paneId: "bond-search",
    label: "Bond Search",
    description: "Corporate and municipal bond yields, spreads, and search.",
    keywords: ["bond", "bonds", "corporate", "municipal", "muni", "yield", "spread", "credit", "fixed income", "cusip", "IG", "HY"],
    shortcut: { prefix: "BOND" },
  }],
  setup(ctx) {
    attachFredSeriesPersistence(ctx.persistence);
    const unregisters = [
      registerConnectionSource({
        id: "fred-corporate-yields",
        name: "FRED Corporate Yields",
        kind: "http",
        pluginId: "bond-search",
        authRequired: false,
      }),
    ];
    return () => unregisters.forEach((fn) => fn());
  },
};
```

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 6: Register in catalogs and update README

Add to `catalog-backend.ts`, `catalog-ui.ts`, and `README.md`.

**Verify**: `bun run typecheck` → exit 0

### Step 7: TUI test (yields tab)

Use tmux: start TUI, open command bar, type `BOND`, Enter, verify yields tab renders with corporate yield data from FRED.

**Verify**: Yields tab renders, data loads, `[r]efresh` works, tabs switch

### Step 8: Phase 2 — Bond search client (STOP if API issues)

**STOP CONDITION**: Before implementing this step, verify that FINRA TRACE API access is available. If you cannot register for FINRA API credentials or the API requires paid access, STOP and report — leave the search tab with an empty state and the yields tab as the deliverable.

If FINRA TRACE is accessible:
- Create `src/plugins/builtin/bond-search/client.ts` with a search function
- Add cloud backend handler in `src/renderers/cloudflare/backend.ts` to proxy FINRA TRACE requests (keeps OAuth credentials server-side)
- Add `apiClient.getCloudBondSearch(query)` in `src/api-client/data.ts`
- Wire the search bar to call the client and display results

If FINRA TRACE is NOT accessible:
- Leave the search tab with: `EmptyState title="Bond search coming soon" hint="Corporate yield indices are available on the Yields tab"`
- Commit Phase 1 as the deliverable
- Report back that FINRA TRACE access is needed for Phase 2

**Verify**: `bun run typecheck` → exit 0

### Step 9: Full verification

**Verify**: `bun run typecheck` → exit 0, `bun test` → all pass

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun test` exits 0
- [ ] `BOND` shortcut opens the pane in the TUI
- [ ] Yields tab shows corporate yield indices from FRED (AAA, AA, A, BBB, IG, HY, maturity slices)
- [ ] Spread vs. Treasury column displays
- [ ] Columns are sortable
- [ ] `[r]efresh` reloads data
- [ ] Tabs switch between Yields and Search
- [ ] Connection source registered
- [ ] If Phase 2 completed: search returns bond results from FINRA TRACE
- [ ] If Phase 2 blocked: search tab shows "coming soon" empty state
- [ ] `plans/README.md` status row updated

## STOP conditions

- FRED corporate yield series (BAMLC0A0CM etc.) don't return data — verify via a test fetch first.
- FINRA TRACE API requires paid access or has restrictive terms — stop at Phase 1 and report.
- MSRB EMMA has no machine-readable API — skip municipal bond search entirely.
- The `DataTableStackView` or `InputSearchBar` API doesn't match — read `src/plugins/builtin/congress-trades/pane.tsx` and `src/plugins/builtin/polls/pane.tsx` for correct usage.
- CORS blocks FRED fetches from the hosted web client — if so, the existing cloud FRED proxy path should be used instead.

## Maintenance notes

- FRED corporate yield series are daily, end-of-day. Show the latest available date.
- The spread calculation depends on Treasury yield data; if the yield-curve pane's data path changes, update the spread source.
- If FINRA TRACE access is obtained later, the search tab can be activated without changing the yields tab.
- Municipal bond data (EMMA) remains a separate effort — no REST API exists today.
- Consider adding corporate yield series to the chart-composer universal series catalog so users can chart spreads alongside other series.
