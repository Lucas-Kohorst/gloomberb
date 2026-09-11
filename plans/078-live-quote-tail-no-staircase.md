# Plan 078: Live quote tails update in place instead of staircasing

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. Skip updating `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 43b8e69c..HEAD -- src/time-series/chart-data.ts src/time-series/chart-data.test.ts src/time-series/live-quotes.ts src/time-series/live-quotes.test.ts src/time-series/resolve.ts`
> If in-scope files changed, compare excerpts; mismatch is a STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `43b8e69c`, 2026-09-11

## Why this matters

Price charts "stagger step" on the right edge when live streaming is on.
Candles merge a quote into the current bar. Line/area charts take the scalar
path of `appendLiveQuotePoint`, which **pushes a new point** whenever
`quoteTime !== latestTime`. A 5s quote poll therefore grows a staircase of
last-price prints after the last daily/weekly bar. The first live print after
history is useful. The second, third, fourth are the bug.

## Current state

`src/time-series/chart-data.ts` scalar branch (lines 144-152):

```144:152:src/time-series/chart-data.ts
  if (quoteTime === latestTime) return points;

  return [
    ...points,
    {
      date: new Date(quoteTime),
      close: quotePrice,
    },
  ];
```

OHLC branch already merges when `quoteBelongsToLatestBar` (lines 119-141).
Gap guard (lines 103-108) **does not run** when last bar spacing is > 6h, so
daily/weekly always qualify for a tail.

`mergeHistory` in `src/time-series/resolve.ts:585-598` uses scalar mode unless
the series style is OHLC (`liveBarResolution` only set for candles/ohlc/hlc
at resolve.ts:1288-1296).

`patchResolvedChartWithLiveQuotes` (`live-quotes.ts:315-320`) always uses
OHLC mode and **returns null** (full re-resolve) when a new bar would be
appended (`extended.length !== history.length`). Full re-resolve then scalar-
appends another print. That is the feedback loop.

Existing test **encodes the first tail** (`chart-data.test.ts:20-36`): weekly
closes plus a quote → length 3. Keep that. Add a second-quote case that must
stay length 3.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `bun test src/time-series/chart-data.test.ts src/time-series/live-quotes.test.ts` | all pass |

Repo uses Bun. Commit: `fix: ...`

## Scope

**In scope**:
- `src/time-series/chart-data.ts`
- `src/time-series/chart-data.test.ts`
- `src/time-series/live-quotes.ts` only if the in-place tail still forces
  `patchResolvedChartWithLiveQuotes` to return null (see step 3)
- `src/time-series/live-quotes.test.ts` only if you touch live-quotes.ts

**Out of scope**:
- Downsample / rasterizer stagger
- Step interpolation for FRED
- Market time scale
- Kitty renderer
- Changing OHLC `quoteBelongsToLatestBar` session alignment (called out as
  CHART-05; not this plan)

## Git workflow

- Branch: `advisor/078-live-quote-tail-no-staircase`
- Commit: `fix: update live quote tails in place on line charts`
- Do NOT push.

## Steps

### Step 1: Replace a scalar live tail instead of appending another

In `appendLiveQuotePoint` scalar path, after the `quoteTime === latestTime`
early return:

If the latest point is already a live tail, **replace it** (new date + close)
instead of concatenating.

Detect a live tail as: latest has no finite `open` / `high` / `low` (a quote
print, not an OHLC bar). Historical daily bars from Yahoo usually have OHLC.
The first quote still **appends** after a real bar (keep test at
chart-data.test.ts:20-36). The second quote sees a close-only last point and
replaces it.

If latest already has OHLC, do not invent a second scalar point when the
quote belongs in that bar — but scalar mode is only used for line/area, and
those histories still carry OHLC fields from Yahoo. For a line series on
daily OHLCV, prefer **updating `close` (and date if you must) on the last
bar** when `quoteBelongsToLatestBar(latestTime, quoteTime, inferred)` is
awkward without a resolution.

Simplest rule that matches the product:

1. If last point is close-only (no finite open/high/low) → replace last point
   with `{ date: quoteTime, close: quotePrice }`.
2. Else append one close-only tail (existing behavior for the first live
   print after a real bar).
3. `quoteTime === latestTime` still no-ops (or updates close if price moved).

Do not append a third, fourth, fifth close-only point.

**Verify**: existing `chart-data.test.ts` still passes after you add the new
test in step 2.

### Step 2: Tests

In `src/time-series/chart-data.test.ts`, next to `"extends coarse chart
histories with a fresh quote tail"`:

1. Keep the existing first-quote test (length 3).
2. New test: start from that extended series, append a later quote
   (`lastUpdated` a few minutes later, price 130). Result length stays 3.
   Last point is `{ date: that later time, close: 130 }`. No extra step.
3. New test: two successive scalar quotes on empty-OHLC tail replace rather
   than grow.
4. Do not change the OHLC merge tests (`merges a quote into the active OHLC
   bucket`, `seeds a new OHLC bucket`).

**Verify**: `bun test src/time-series/chart-data.test.ts`

### Step 3: Live patch should not full-resolve a close-only tail update

If `patchResolvedChartWithLiveQuotes` still returns null because
`appendLiveQuotePoint` in OHLC mode appends a new bucket (`live-quotes.ts:320`),
line charts can still re-resolve and stair-step.

After step 1, a line series last point is close-only. OHLC mode on that last
point: `quoteBelongsToLatestBar` uses `CHART_RESOLUTION_STEP_MS[resolution]`.
For daily, 5s later is still the same 24h bucket → merge, length unchanged,
patch succeeds. That should be enough.

If `live-quotes.test.ts` has a case that expected a full resolve on a second
print, update it to expect an in-place patch.

Only edit `live-quotes.ts` if a test proves the patch still returns null for
the scalar tail. Prefer fixing `appendLiveQuotePoint` over widening the patch
function.

**Verify**: `bun test src/time-series/chart-data.test.ts src/time-series/live-quotes.test.ts`

## Test plan

- First live print after weekly/daily history still extends length by 1.
- Second live print does not.
- OHLC candle merge/new-bucket tests unchanged.
- Pattern: `src/time-series/chart-data.test.ts`.

## Done criteria

- [ ] Scalar `appendLiveQuotePoint` never grows more than one close-only tail
- [ ] First-tail test still passes
- [ ] New replace-in-place test passes
- [ ] `bun test src/time-series/chart-data.test.ts src/time-series/live-quotes.test.ts` exits 0
- [ ] No rasterizer / composer pane edits

## STOP conditions

- You need to change `quoteBelongsToLatestBar` session/timezone math (CHART-05).
- Line series last bars have open/high/low filled (Yahoo), so rule 1 never
  fires and you would append forever — then update last-bar **close** when
  the quote is after latestTime **and** a close-only tail already exists
  **or** when last bar OHLC is same-session. Do not drop the first tail.
- Tests require network.

## Maintenance notes

Reviewers: one extra live print after the last session is intentional (chart
extends to "now"). A sawtooth of intra-second prints is not. Do not use
step-after interpolation to hide this.
