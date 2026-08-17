# Plan 023: Add volatility and sentiment term-structure pane

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat b9d938f..HEAD -- src/plugins/builtin/fear-greed/ src/plugins/builtin/chart-composer/series-catalog.ts src/plugins/catalog-backend.ts src/plugins/catalog-ui.ts`
> If the directory structure has changed significantly, treat as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `b9d938f`, 2026-08-17

## Why this matters

The app already has scattered sentiment signals: VIX in the fear-greed pane, put/call ratio as a fear-greed indicator, and VIX as a world index. But there's no unified volatility dashboard showing the VIX futures term structure, realized vs. implied volatility, or sentiment surveys. A single pane showing spot VIX, VIX futures curve (contango/backwardation), realized vol, put/call ratio, and AAII sentiment would turn scattered signals into a tradable regime view.

## Current state

**Existing patterns to follow:**

1. **Fear & Greed pane** (`src/plugins/builtin/fear-greed/`) — fetches from CNN, normalizes multiple indicators, each with its own chart. This is the closest pattern: multiple series displayed together with charts and values.

2. **Yield curve pane** (`src/plugins/builtin/yield-curve/`) — uses `StaticChartSurface` for chart rendering, FRED data for yields. The chart pattern is directly applicable for VIX term structure.

3. **Universal series catalog** (`src/plugins/builtin/chart-composer/series-catalog.ts` and `universal-series.ts`) — already defines FRED-backed series. New FRED series can be added here for chart composer integration.

**Data sources (all public, no auth):**

1. **FRED** (already integrated via `src/data/fred-series.ts`):
   - `VIXCLS` — VIX close (daily)
   - `VXVCLS` — VXV (3-month VIX) close (daily)
   - `VXMTCLS` — VXMT (6-month VIX) close (daily)
   - Use these for spot VIX and term structure proxies

2. **CBOE** — daily market statistics:
   - VIX futures settlement data is published daily
   - Historical data available via CBOE's downloadable files
   - May need cloud proxy for CORS

3. **AAII Sentiment Survey** — weekly:
   - Published every Thursday
   - Bullish/Bearish/Neutral percentages
   - No official API; data is on the AAII website
   - Start with FRED or manual entry; skip if no reliable programmatic source

**Existing FRED integration:**

The FRED series system (`src/data/fred-series.ts`) already has caching, persistence, and a cloud API path. The econ plugin uses `attachFredSeriesPersistence` in its `setup()`. New series can be fetched via `loadCachedFredSeries`.

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Typecheck | `bun run typecheck:opentui`      | exit 0              |
| Full TC   | `bun run typecheck`              | exit 0              |
| Tests     | `bun test`                       | all pass            |
| TUI test  | tmux session                     | pane renders        |

## Scope

**In scope** (create):
- `src/plugins/builtin/volatility/types.ts` — types for vol metrics
- `src/plugins/builtin/volatility/client.ts` — FRED series fetcher for VIX/VXV/VXMT
- `src/plugins/builtin/volatility/model.ts` — normalization, term structure calculation
- `src/plugins/builtin/volatility/pane.tsx` — React pane with charts and values
- `src/plugins/builtin/volatility/index.tsx` — GloomPlugin definition

**Modify**:
- `src/plugins/catalog-backend.ts` — register
- `src/plugins/catalog-ui.ts` — register
- `README.md` — add shortcut

**Out of scope**:
- CBOE futures data — start with FRED VIX/VXV/VXMT only. CBOE futures require CORS proxy and schema validation.
- AAII sentiment — no reliable free API. Skip for now; add later if a data source is found.
- Realized volatility calculation — requires historical OHLCV; can be computed from existing price history but adds complexity. Defer to v2.
- Chart composer integration — adding series to the universal catalog is a separate enhancement.

## Git workflow

- Branch: `advisor/023-volatility-sentiment`
- Commit per file or logical unit
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Create types

Create `src/plugins/builtin/volatility/types.ts`:

```typescript
export interface VolMetric {
  id: string;
  label: string;
  value: number | null;
  unit: string;       // "pts", "%", "ratio"
  sparkline: { date: Date; value: number }[];
  description: string;
}

export type LoadStatus = "idle" | "loading" | "loaded" | "error";

export interface VolTermStructurePoint {
  tenor: string;      // "Spot", "3M", "6M"
  value: number | null;
}

export interface VolData {
  vix: VolMetric;
  vxv: VolMetric;
  vxvVixRatio: VolMetric;  // VXV/VIX — term structure signal (>1 = contango, <1 = backwardation)
  termStructure: VolTermStructurePoint[];
  updatedAt: Date | null;
}
```

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 2: Create client

Create `src/plugins/builtin/volatility/client.ts` that:
- Fetches VIXCLS, VXVCLS, VXMTCLS from FRED via the existing `loadCachedFredSeries` system
- Extracts the latest value and a 30-day sparkline for each series
- Computes VXV/VIX ratio for term structure signal
- Builds the term structure curve from spot (VIX), 3M (VXV), 6M (VXMT)

Follow the pattern in `src/plugins/builtin/econ/fred-series-map.ts` for how FRED series are fetched. Use `attachFredSeriesPersistence` in the plugin's `setup()`.

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 3: Create model

Create `src/plugins/builtin/volatility/model.ts` with:
- Normalization from raw FRED observations to `VolMetric[]`
- Sparkline data extraction (last 30 observations)
- Term structure classification (contango vs. backwardation)
- Color coding: backwardation = warning/negative, contango = neutral/positive

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 4: Create pane component

Create `src/plugins/builtin/volatility/pane.tsx`:
- Display spot VIX value prominently with sparkline
- Show VXV/VIX ratio with contango/backwardation label
- Show term structure as a small bar chart or line chart (use `StaticChartSurface` from the yield-curve pattern)
- Show VXV and VXMT values with sparklines
- `[r]efresh` to reload
- `usePaneStatusFooter` for status
- Loading/error/empty states

Layout (top to bottom):
```
┌─ Volatility & Sentiment ──────────────────────┐
│ VIX        15.42  ▁▂▃▄▅▆▇█▇▆▅▄▃▂▁  contango   │
│ VXV/VIX    1.08   term structure signal        │
│                                                │
│ Term Structure                                 │
│ Spot  3M   6M                                  │
│ 15.4  16.7 17.2                               │
│                                                │
│ VXV        16.70  ▁▂▃▄▅▆▇█▇▆▅▄▃▂▁              │
│ VXMT       17.20  ▁▂▃▄▅▆▇█▇▆▅▄▃▂▁              │
└────────────────────────────────────────────────┘
```

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 5: Create plugin definition

Create `src/plugins/builtin/volatility/index.tsx`:

```typescript
export const volatilityModule: PluginModule = {
  panes: [{
    id: "volatility",
    name: "Volatility & Sentiment",
    icon: "V",
    component: VolatilityPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 70, height: 22 },
  }],
  paneTemplates: [{
    id: "volatility-pane",
    paneId: "volatility",
    label: "Volatility & Sentiment",
    description: "VIX, VXV, term structure, and sentiment indicators.",
    keywords: ["vix", "volatility", "vxv", "vxmt", "term structure", "contango", "backwardation", "sentiment", "fear", "greed"],
    shortcut: { prefix: "VIX" },
  }],
  setup(ctx) {
    attachFredSeriesPersistence(ctx.persistence);
    const unregister = registerConnectionSource({
      id: "fred-volatility",
      name: "FRED Volatility Series",
      kind: "http",
      pluginId: "volatility",
      authRequired: false,
    });
    return () => { unregister(); };
  },
};
```

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 6: Register in catalogs

Add to both `src/plugins/catalog-backend.ts` and `src/plugins/catalog-ui.ts`.

**Verify**: `bun run typecheck` → exit 0

### Step 7: Update README

Add `VIX` to the command reference table.

**Verify**: `bun run typecheck` → exit 0

### Step 8: TUI test

Use tmux: start TUI, open command bar, type `VIX`, Enter, verify pane renders with VIX data.

**Verify**: Pane renders, data loads, `[r]efresh` works

### Step 9: Full verification

**Verify**: `bun run typecheck` → exit 0, `bun test` → all pass

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun test` exits 0
- [ ] `VIX` shortcut opens the pane in the TUI
- [ ] VIX, VXV, VXMT values load from FRED
- [ ] VXV/VIX ratio and contango/backwardation label display
- [ ] Term structure chart renders
- [ ] `[r]efresh` reloads data
- [ ] Connection source registered
- [ ] `plans/README.md` status row updated

## STOP conditions

- FRED series IDs (VIXCLS, VXVCLS, VXMTCLS) don't return data — verify via the existing FRED client first. VXMTCLS may have limited history; if it's unavailable, use only VIX and VXV.
- The `loadCachedFredSeries` API doesn't match what's described — read `src/data/fred-series.ts` for the exact interface.
- `StaticChartSurface` doesn't support the chart type needed — read `src/plugins/builtin/yield-curve/index.tsx` for the correct usage pattern.

## Maintenance notes

- FRED series are updated daily (end-of-day). The pane should show the latest available date, not "now."
- If CBOE futures data is added later, the term structure section can be extended with actual futures prices instead of VXV/VXMT proxies.
- The FRED cache policy (24h stale, 30d expire) in `src/data/fred-series.ts` is appropriate for daily data.
