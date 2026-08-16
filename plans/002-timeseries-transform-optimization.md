# Plan 002: Replace O(n²) referencePoint scan with binary search

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7065caf..HEAD -- src/time-series/transforms.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `7065caf`, 2026-08-16

## Why this matters

`referencePoint()` in `src/time-series/transforms.ts` iterates from index 0 to
`currentIndex` for every point in a time series when computing yoy (year-over-year)
and qoq (quarter-over-quarter) transforms. This is called inside `.map()` in
`applySeriesTransform()`, producing O(n²) total work. A series with 5,000 daily
price points (~20 years) requires ~12.5M comparisons per transform. The chart
resolver calls this on every chart resolution cycle, including live quote
updates that re-resolve the spec.

Since the points array is sorted ascending by date, binary search can find the
candidate nearest the target date in O(log n) per point, reducing total
complexity from O(n²) to O(n log n).

## Current state

**`src/time-series/transforms.ts`** — `referencePoint` function (lines 50-69):

```typescript
function referencePoint(
  points: readonly TimeSeriesPoint[],
  currentIndex: number,
  months: number,
  toleranceDays: number,
): TimeSeriesPoint | null {
  const current = points[currentIndex];
  if (!current) return null;
  const currentTime = current.observedAt.getTime();
  const target = shiftUtcMonths(current.observedAt, months).getTime();
  let best: { point: TimeSeriesPoint; distance: number; date: number } | null = null;
  for (let index = 0; index < currentIndex; index += 1) {
    const candidate = points[index]!;
    const candidateTime = candidate.observedAt.getTime();
    if (!Number.isFinite(candidateTime) || candidateTime >= currentTime) continue;
    const distance = Math.abs(candidateTime - target);
    if (distance > toleranceDays * DAY_MS) continue;
    if (!best || distance < best.distance || (distance === best.distance && candidateTime > best.date)) {
      best = { point: candidate, distance, date: candidateTime };
    }
  }
  return best?.point ?? null;
}
```

It is called from `applySeriesTransform()` (line 94+) inside a `.map()` for
`yoy` and `qoq` transforms. The points array is sorted ascending by date at
line 99 (`points.sort((left, right) => left.date.getTime() - right.date.getTime())`).

**Convention**: The time-series module uses pure functions with explicit types.
Tests live alongside as `*.test.ts`. See `src/time-series/transforms.test.ts`
for the existing test pattern.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Install   | `bun install`            | exit 0              |
| Typecheck | `bun run typecheck`      | exit 0, no errors   |
| Tests     | `bun test src/time-series/transforms.test.ts` | all pass |

## Scope

**In scope** (the only files you should modify):
- `src/time-series/transforms.ts`
- `src/time-series/transforms.test.ts` (add tests)

**Out of scope** (do NOT touch):
- `src/time-series/alignment.ts` — separate finding (Plan 003)
- `src/time-series/studies.ts` — separate finding
- `src/time-series/resolve.ts` — separate finding (Plan 005)
- Any caller of `applySeriesTransform` — the function signature does not change

## Git workflow

- Branch: `advisor/002-timeseries-transform-optimization`
- Commit per logical unit; message style: `Optimize referencePoint scan from O(n²) to O(n log n)`

## Steps

### Step 1: Implement binary search for referencePoint

Replace the linear scan in `referencePoint()` with a binary search approach:

1. Use binary search to find the insertion point for `target` in the
   `points[0..currentIndex)` range (sorted by `observedAt` ascending).
2. Check the candidate at the insertion point and its neighbors (within
   `toleranceDays * DAY_MS` of target) to find the closest match.
3. Apply the same tie-breaking logic: closest distance wins; equal distance
   prefers later date.

The function signature and return type must not change. The output must be
identical for all inputs — this is a performance optimization, not a behavior
change.

**Verify**: `bun run typecheck` → exit 0, no errors

### Step 2: Add edge-case tests

Add tests to `src/time-series/transforms.test.ts` for `referencePoint` via
`applySeriesTransform` with `yoy` transform:

- Series with < 12 points (no reference point possible for yoy)
- Series with exactly 12 monthly points (boundary)
- Series with 1000 daily points (performance — verify it completes quickly)
- Series with duplicate timestamps (tie-breaking by later date)
- Series with gaps > toleranceDays (no match within tolerance)

**Verify**: `bun test src/time-series/transforms.test.ts` → all pass

### Step 3: Verify output equivalence

Run the full existing test suite to confirm no behavior change:

**Verify**: `bun test src/time-series/` → all pass

## Test plan

- Add tests to existing `src/time-series/transforms.test.ts`
- Cases: small series, exact boundary, large series performance, duplicate
  timestamps, gaps exceeding tolerance
- Pattern: existing tests in the same file

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun test src/time-series/transforms.test.ts` exits 0; new tests pass
- [ ] `bun test src/time-series/` exits 0 (no regressions)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts
  (the codebase has drifted since this plan was written).
- The binary search produces different results than the linear scan for any
  test case — the output must be identical.
- You discover that `points` is not always sorted ascending (the sort at line
  99 is conditional or has been removed).

## Maintenance notes

- If new transform types are added that call `referencePoint`, they
  automatically benefit from the optimization.
- A reviewer should run the chart composer with a 20-year daily series and a
  yoy transform to confirm the UI is responsive.
