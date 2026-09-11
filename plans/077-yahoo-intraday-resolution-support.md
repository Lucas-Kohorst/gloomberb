# Plan 077: Advertise 1m (and 30m/4h) where Yahoo can serve them

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. Skip updating `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 43b8e69c..HEAD -- src/time-series/resolution.ts src/time-series/resolve.ts src/sources/yahoo-finance/history.ts src/sources/yahoo-finance.ts src/sources/gloomberb-cloud/index.ts src/plugins/builtin/chart-composer/presets.ts`
> If in-scope files changed, compare excerpts; mismatch is a STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: none (pairs with 076; do not edit pane.tsx)
- **Category**: bug
- **Planned at**: commit `43b8e69c`, 2026-09-11

## Why this matters

`GIP` (intraday price) and Auto on 1D request **1-minute** bars
(`getPresetResolution("1D") === "1m"`). Yahoo's advertised support map omits
1m entirely, and Yahoo's `getPriceHistory` fallback for 1D fetches **5m**.
Manual 1m is treated as unsupported even though Yahoo's v8 chart API accepts
`interval=1m` for about seven days. Cloud already advertises 1m (max 1W) and
1h (max 1Y). Align Yahoo defaults with what the API can actually return so
interval tabs stop lying.

## Current state

`src/time-series/resolution.ts` presets and Yahoo-shaped defaults:

```29:38:src/time-series/resolution.ts
const RANGE_PRESET_RESOLUTION: Record<TimeRange, ManualChartResolution> = {
  "1D": "1m",
  "1W": "5m",
  "1M": "15m",
  "3M": "1h",
  "6M": "1d",
  "1Y": "1d",
  "5Y": "1wk",
  "ALL": "1mo",
};
```

```163:171:src/time-series/resolution.ts
export const DEFAULT_CHART_RESOLUTION_SUPPORT: ChartResolutionSupport[] = normalizeChartResolutionSupport([
  { resolution: "5m", maxRange: "1W" },
  { resolution: "15m", maxRange: "1M" },
  { resolution: "1h", maxRange: "3M" },
  { resolution: "1d", maxRange: "5Y" },
  { resolution: "1wk", maxRange: "ALL" },
  { resolution: "1mo", maxRange: "ALL" },
]);
```

Yahoo aliases that map:

```15:26:src/sources/yahoo-finance/history.ts
const RANGE_PARAMS: Record<TimeRange, { range: string; interval: ManualChartResolution }> = {
  "1D": { range: "1d", interval: "5m" },
  "1W": { range: "5d", interval: "5m" },
  ...
};
const YAHOO_RESOLUTION_SUPPORT = DEFAULT_CHART_RESOLUTION_SUPPORT;
```

`loadYahooPriceHistoryForResolution` already passes `resolution` through to
`fetchChart` (`history.ts:82-104`). `4h` is aggregated from `1h` (line 82, 104).
Yahoo v8 `fetchYahooChart` puts `interval` on the query string
(`src/sources/yahoo-finance/requests.ts:38-40`).

Cloud (leave Cloud numbers alone unless a test breaks):

```55:65:src/sources/gloomberb-cloud/index.ts
const CLOUD_RESOLUTION_SUPPORT = normalizeChartResolutionSupport([
  { resolution: "1m", maxRange: "1W" },
  { resolution: "5m", maxRange: "1M" },
  { resolution: "15m", maxRange: "3M" },
  { resolution: "30m", maxRange: "6M" },
  { resolution: "1h", maxRange: "1Y" },
  { resolution: "4h", maxRange: "1Y" },
  { resolution: "1d", maxRange: "5Y" },
  { resolution: "1wk", maxRange: "5Y" },
  { resolution: "1mo", maxRange: "ALL" },
]);
```

Price-only resolve uses **immediate** support. If `getChartResolutionSupport`
returns a Promise (the live router), it **does not wait** and uses DEFAULT:

```444:456:src/time-series/resolve.ts
function readImmediateResolutionSupport(...) {
  ...
  if (Array.isArray(result)) return normalizeChartResolutionSupport(result);
  if (isThenable(result)) return DEFAULT_CHART_RESOLUTION_SUPPORT;
  return DEFAULT_CHART_RESOLUTION_SUPPORT;
}
```

`src/plugins/builtin/chart-composer/presets.ts:1595-1604` —
`buildIntradayPriceChartPreset` hardcodes `{ range: "1D", resolution: "1m" }`.
Leave that. After this plan, Yahoo support includes 1m for 1D so GIP is honest.

Do **not** add `45m`. No provider advertises it (`gloomberb-cloud/index.test.ts:423-425`).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `bun test src/time-series/resolution.test.ts src/time-series/resolve.test.ts src/sources/yahoo-finance/history.ts src/sources/gloomberb-cloud/index.test.ts src/plugins/builtin/chart-composer/presets.test.ts` | all pass |

If `history.ts` has no colocated tests, run `bun test src/sources/yahoo-finance/` instead.

Repo uses Bun. Commit: `fix: ...`

## Scope

**In scope**:
- `src/time-series/resolution.ts` (DEFAULT support map only)
- `src/time-series/resolution.test.ts` (assertions that mention DEFAULT contents)
- `src/sources/yahoo-finance/history.ts` (`RANGE_PARAMS["1D"]`)
- Tests under `src/sources/yahoo-finance/` that assert 1D → 5m
- `src/time-series/resolve.ts` only if a test proves immediate Promise support
  still blocks Cloud 1m **after** DEFAULT includes 1m — see STOP / step 3

**Out of scope**:
- Composer pane UI (plan 076)
- `45m`
- Widening Yahoo 1h past 3M (Yahoo allows ~2y; leave 3M unless a test requires it)
- `src/sources/yahoo-finance/requests.ts` quote snapshot `interval: "5m", range: "1d"` (that is quotes, not charts)
- Kitty renderer

## Git workflow

- Branch: `advisor/077-yahoo-intraday-resolution-support`
- Commit: `fix: advertise yahoo 1m 30m and 4h chart intervals`
- Do NOT push.

## Steps

### Step 1: Extend DEFAULT_CHART_RESOLUTION_SUPPORT

In `src/time-series/resolution.ts`, change DEFAULT to:

```ts
export const DEFAULT_CHART_RESOLUTION_SUPPORT: ChartResolutionSupport[] = normalizeChartResolutionSupport([
  { resolution: "1m", maxRange: "1D" },
  { resolution: "5m", maxRange: "1W" },
  { resolution: "15m", maxRange: "1M" },
  { resolution: "30m", maxRange: "1M" },
  { resolution: "1h", maxRange: "3M" },
  { resolution: "4h", maxRange: "3M" },
  { resolution: "1d", maxRange: "5Y" },
  { resolution: "1wk", maxRange: "ALL" },
  { resolution: "1mo", maxRange: "ALL" },
]);
```

Yahoo 1m is ~7 calendar days, so **maxRange is `1D`**, not Cloud's `1W`.
30m Yahoo window is ~60d → `1M`. 4h is derived from 1h, so same `3M` cap as 1h.

Do not change `RANGE_PRESET_RESOLUTION`. 1D stays `1m`.

**Verify**: `bun test src/time-series/resolution.test.ts` — fix any assertion
that listed DEFAULT contents without 1m/30m/4h.

### Step 2: Yahoo 1D fallback interval is 1m

In `src/sources/yahoo-finance/history.ts`, set

```ts
"1D": { range: "1d", interval: "1m" },
```

Leave 1W at 5m. `loadYahooPriceHistoryForResolution` already sends `1m` when
asked; this only aligns Auto's `getPriceHistory` fallback with the 1D preset.

Update tests that expect 1D chart fetches to use `5m`. Do **not** change the
quote-summary 5m/1d request in `requests.ts:118`.

**Verify**: `bun test src/sources/yahoo-finance/` and
`bun test src/time-series/resolve.test.ts`.

### Step 3: Immediate Promise support (only if tests demand it)

`readImmediateResolutionSupport` returns DEFAULT when the provider method
returns a Promise. After step 1, DEFAULT includes 1m for 1D, so Yahoo-shaped
router fallback is correct for GIP.

Do **not** rewrite resolve to await router support in this plan. If
`resolve.test.ts:331-384` (async support skipped) still passes and documents
the Promise shortcut, leave it. STOP and report if a Cloud-specific test now
fails because DEFAULT 1m maxRange is 1D while Cloud is 1W — that is acceptable
for immediate paint; Cloud's full map still applies on the non-immediate path.

**Verify**: `bun test src/time-series/resolve.test.ts src/sources/gloomberb-cloud/index.test.ts`

### Step 4: GIP preset still 1D/1m

Confirm `buildIntradayPriceChartPreset` in `presets.ts` is still
`{ range: "1D", resolution: "1m" }`. Do not change it.
`bun test src/plugins/builtin/chart-composer/presets.test.ts`.

## Test plan

- resolution tests: DEFAULT now includes `{ resolution: "1m", maxRange: "1D" }`
  and 30m/4h as above; `getSupportedChartResolutionsForViewport("1D", DEFAULT)`
  includes `1m` and `5m`.
- Any Yahoo history test that encoded 1D → 5m becomes 1D → 1m.
- Pattern: `src/time-series/resolution.test.ts`, `src/sources/gloomberb-cloud/index.test.ts`.

## Done criteria

- [ ] DEFAULT advertises 1m (1D), 30m (1M), 4h (3M)
- [ ] Yahoo `RANGE_PARAMS["1D"].interval` is `"1m"`
- [ ] 45m still not advertised by Cloud or DEFAULT
- [ ] `bun test` commands in the table exit 0
- [ ] No pane.tsx edits

## STOP conditions

- Yahoo fetch layer rejects `interval=1m` in existing tests (do not stub a fake
  5m remap).
- You feel you must await router `getChartResolutionSupport` to make GIP work.
  Report instead; DEFAULT 1m is the intended first-paint fix.
- Drift in `RANGE_PRESET_RESOLUTION` (do not change 1D away from 1m).

## Maintenance notes

Yahoo may 400 if someone requests 1m with a buffer wider than ~7d. Support
`maxRange: "1D"` plus existing `clampTimeRangeToMaxRange` in resolve should
prevent that. If 077 + 076 both land, 1D range tab becomes enabled because
the 1D preset interval is now in DEFAULT.
