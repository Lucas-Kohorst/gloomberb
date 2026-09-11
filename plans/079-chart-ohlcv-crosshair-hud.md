# Plan 079: Show O H L C V on the chart crosshair

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. Skip updating `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 43b8e69c..HEAD -- src/components/chart/composite/format.ts src/components/chart/composite/format.test.ts src/components/chart/composite/composite-chart.tsx src/renderers/electrobun/view/host/tradingview-chart.tsx`
> If in-scope files changed, compare excerpts; mismatch is a STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `43b8e69c`, 2026-09-11

## Why this matters

AAPL daily on TradingView is usable because the crosshair prints
O / H / L / C / V for the hovered bar. Gloom already stores those fields on
`TimeSeriesPoint` (`src/time-series/types.ts:161-170`) and already snaps the
cursor to a bar. The legend and desktop tooltip only print a single scalar
close. Traders cannot read the candle they are looking at.

## Current state

Legend (`src/components/chart/composite/composite-chart.tsx:1331-1348`):

```ts
const fullText = entry.points.length === 0
  ? `${entry.label}...`
  : `${entry.label} ${legendValue(entry, cursorValue?.value ?? null, formatValue)}${changeText}`;
const details = formatCompositePointDetails(cursorValue?.point);
const tooltip = details ? `${fullText} · ${details}` : fullText;
```

`formatCompositePointDetails` (`format.ts:134-153`) is period/provenance, not
OHLC.

Desktop Lightweight Charts tooltip (`tradingview-chart.tsx:363-386`) reads
`value?.value ?? value?.close` only:

```ts
const numeric = value?.value ?? value?.close;
return finite(numeric)
  ? [`${entry.label}: ${formatChartLegendValue(numeric, entry.unit, entry.unitGroup)}`]
  : [];
```

Candlestick `param.seriesData` is `{ open, high, low, close }`. Histogram
volume is `{ value }`.

`formatChartLegendValue` and `compactNumber` already live in `format.ts`.
Reuse them. Volume uses compactNumber (48.2M) not a currency prefix.

`TimeSeriesPoint` fields: `open?`, `high?`, `low?`, `close?`, `volume?`,
`value`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `bun test src/components/chart/composite/format.test.ts` | all pass |

Repo uses Bun. Commit: `fix: ...` or `feat: show ohlcv on chart crosshair`

## Scope

**In scope**:
- `src/components/chart/composite/format.ts`
- `src/components/chart/composite/format.test.ts`
- `src/components/chart/composite/composite-chart.tsx` (legend `fullText` /
  tooltip only)
- `src/renderers/electrobun/view/host/tradingview-chart.tsx` (crosshair
  tooltip handler only)

**Out of scope**:
- New drawing tools, log shortcut, session time scale
- Changing `formatCompositePointDetails` semantics (keep provenance as extra
  tooltip detail)
- Kitty renderer, rasterizer geometry
- Volume-on-price overlay

## Git workflow

- Branch: `advisor/079-chart-ohlcv-crosshair-hud`
- Commit: `feat: show OHLC V on chart crosshair`
- Do NOT push.

## Steps

### Step 1: Formatter

In `src/components/chart/composite/format.ts`, add:

```ts
export function formatOhlcvHud(
  point: Pick<TimeSeriesPoint, "open" | "high" | "low" | "close" | "volume" | "value"> | null | undefined,
  unit: string,
  unitGroup = "",
): string | null
```

Rules:
- Let `close = point.close ?? point.value`. If close is not a finite number,
  return null.
- Let `open/high/low` be finite numbers or missing.
- If **none** of open/high/low are finite, return null (scalar series keep
  the existing single-value legend).
- Format prices with `formatChartLegendValue(..., unit, unitGroup)`.
- Build a compact string like `O 326.10  H 328.40  L 325.20  C 326.37`.
  Omit any missing side (e.g. hlc style has no open → no `O`).
- If `volume` is a finite number ≥ 0, append `  V 48.2M` using the same
  compactNumber already in this file (do not treat volume as currency).
  You may extract compactNumber use via a tiny local helper rather than
  exporting it.
- Separate tokens with two spaces so the HUD is scannable.

**Verify**: add tests in step 2; run them.

### Step 2: Tests

In `src/components/chart/composite/format.test.ts` (pattern: existing
`formatChartLegendValue` test around line 180):

1. Full OHLCV → string contains `O`, `H`, `L`, `C`, `V` and the formatted
   prices / compact volume.
2. Close-only point → `null`.
3. HLC (open missing) → no `O`, still H L C.
4. Zero volume still prints `V 0`.

**Verify**: `bun test src/components/chart/composite/format.test.ts`

### Step 3: Legend uses the HUD when the cursor is on an OHLC bar

In `composite-chart.tsx` legend builder (~1331-1348):

When `cursorValue?.point` is set, `hud = formatOhlcvHud(point, entry.unit, entry.unitGroup)`.
If hud is non-null, `fullText` is `${entry.label} ${hud}` (keep
`changeText` only when there is **no** cursor date, as today).

If hud is null, keep the current scalar `legendValue`.

Still append `formatCompositePointDetails` onto the tooltip, not the visible
truncated legend (the visible text is capped at 30 chars today —
`textWidth = Math.min(30, ...)`).

**Problem**: 30 characters will clip `O 326.10  H 328.40  L 325.20  C 326.37  V 48.2M`.

Fix: when hud is present, raise the visible cap so the HUD can show. Use
`Math.min(72, [...fullText].length)` when hud is non-null, else keep 30.
Do not let a 72-char legend overflow a 40-col pane: `Math.min(Math.max(30, width - 4), hud ? 72 : 30)`
is too clever if `width` is not in scope. The legend function receives
`scene` and parent width is on CompositeChart.

Look at the legend component signature around line 1310. If `width` is
available, cap HUD legend to `Math.max(24, Math.min(width - 2, [...fullText].length))`.
If width is not available, cap at 72 for hud and 30 otherwise.

The **tooltip** (`title` / `tooltip` variable) must contain the **full** HUD
even when the visible label is truncated.

**Verify**: `bun test src/components/chart/composite/format.test.ts`
and any existing `composite-chart.test.tsx` that asserts legend text.
If a legend snapshot is too short, update it.

### Step 4: Desktop Lightweight Charts tooltip

In `tradingview-chart.tsx` `handleCrosshairMove`:

For each series, read `param.seriesData.get(entry.api)`.

If the datum has finite `open`/`high`/`low`/`close` (candlestick/bar),
format via `formatOhlcvHud({ open, high, low, close, volume: undefined, value: close }, entry.unit, entry.unitGroup)`.
Volume is a **separate** histogram series; include that series' `value` as
volume on its own line (`${entry.label}: ${compact}`) or, if the volume
series label contains "Volume", show `V ${compactNumber}`.

Keep scalar fallback: `value ?? close` through `formatChartLegendValue`.

Join series with two spaces as today.

**Verify**: no dedicated LWC test is required if none exists. Do not add a
Playwright suite. If `tradingview-chart` has a unit test, update it.

## Test plan

- formatOhlcvHud cases above
- Do not add a low-value "legend calls formatter" render test
- Pattern: `src/components/chart/composite/format.test.ts`

## Done criteria

- [ ] `formatOhlcvHud` exported and tested
- [ ] Cursor legend shows O/H/L/C (and V when present) for candle series
- [ ] Scalar series unchanged (hud null)
- [ ] Desktop tooltip shows OHLC for candlesticks
- [ ] `bun test src/components/chart/composite/format.test.ts` exits 0
- [ ] No files outside the in-scope list

## STOP conditions

- Legend width plumbing requires rewriting CompositeChart layout (report;
  ship formatter + tooltip only if legend cap cannot be raised safely).
- You cannot find `cursorValue.point` on the legend path.

## Maintenance notes

Reviewers: visible legend may still truncate on a 40-col terminal; tooltip
must have the full HUD. Do not put the HUD in the pane footer (footers are
for changing status, not static labels).
