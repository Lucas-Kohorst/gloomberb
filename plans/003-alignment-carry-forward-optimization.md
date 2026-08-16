# Plan 003: Replace O(n×m) carry-forward scan with moving pointer

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7065caf..HEAD -- src/time-series/alignment.ts`
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

In `alignTimeSeries()`, the carry-forward branch re-scans all points in a
series for every timeline timestamp to find the most recent eligible
predecessor. With `sortedTimes` of length T and each series of length P, this
is O(T×P) per series. This function is used by `resolveStudies()` for
correlation/ratio/spread pair studies and by chart alignment. With multiple
series and long histories, this becomes the dominant cost of study computation
on every chart resolution.

Since both `sortedTimes` and `entry.points` are sorted ascending by effective
time, a moving pointer per series can advance to the last eligible point for
each timeline row, avoiding the full re-scan and reducing complexity to O(T+P)
per series.

## Current state

**`src/time-series/alignment.ts`** — carry-forward branch inside the main
loop (lines 89-117):

```typescript
      const allowCarry = options.carryForward ?? entry.interpolation === "step-after";
      if (!allowCarry) {
        values[entry.id] = null;
        return;
      }

      let previous: TimeSeriesPoint | null = null;
      let previousEligibleAt = Number.NEGATIVE_INFINITY;
      for (const point of entry.points) {
        const eligibleAt = effectiveTimeSeriesPointTime(point);
        if (eligibleAt <= time && eligibleAt >= previousEligibleAt) {
          previous = point;
          previousEligibleAt = eligibleAt;
        }
      }
      if (!previous) {
        values[entry.id] = null;
        return;
      }
      const age = time - previousEligibleAt;
      if (options.maxCarryMilliseconds !== undefined && age > options.maxCarryMilliseconds) {
        values[entry.id] = null;
        return;
      }
      values[entry.id] = {
        point: previous,
```

The outer loop iterates `sortedTimes` (sorted ascending). `entry.points` is
also sorted ascending by effective time (enforced by the caller or by the
`exactMaps` construction above).

**Convention**: Pure functions, explicit types, tests in `*.test.ts`. See
`src/time-series/alignment.test.ts` if it exists, or `src/time-series/transforms.test.ts`
for the pattern.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Install   | `bun install`            | exit 0              |
| Typecheck | `bun run typecheck`      | exit 0, no errors   |
| Tests     | `bun test src/time-series/` | all pass         |

## Scope

**In scope** (the only files you should modify):
- `src/time-series/alignment.ts`
- `src/time-series/alignment.test.ts` (add tests if file exists; create if not)

**Out of scope** (do NOT touch):
- `src/time-series/transforms.ts` — Plan 002
- `src/time-series/studies.ts` — separate finding
- `src/time-series/resolve.ts` — Plan 005
- Any caller of `alignTimeSeries` — the function signature does not change

## Git workflow

- Branch: `advisor/003-alignment-carry-forward-optimization`
- Commit message: `Optimize carry-forward scan from O(n×m) to O(n+m) in alignTimeSeries`

## Steps

### Step 1: Replace the inner scan with a moving pointer

The key insight: `sortedTimes` is iterated ascending, and `entry.points` is
sorted ascending by effective time. So for each series, we can maintain a
pointer that only moves forward.

Refactor the carry-forward branch to use a per-series pointer:

1. Before the `sortedTimes` loop, initialize a `Map<string, number>` (or
   array indexed by series index) tracking the current pointer position for
   each series.
2. Inside the loop, for each series, advance the pointer while the next point's
   effective time ≤ current timeline time. The last point passed is the
   `previous`.
3. Apply the same `maxCarryMilliseconds` and null checks.

The function signature and output must be identical. This is purely
algorithmic — same results, faster.

**Verify**: `bun run typecheck` → exit 0, no errors

### Step 2: Add tests for carry-forward correctness

Add tests to `alignment.test.ts` (create if it doesn't exist):

- Two series with different frequencies (daily + monthly) on a shared timeline
  — verify carry-forward fills monthly values between daily points
- Series with a gap larger than `maxCarryMilliseconds` — verify null, not stale
- Series where no point is earlier than the first timeline timestamp — verify null
- Step-after interpolation series — verify carry-forward is applied by default

**Verify**: `bun test src/time-series/alignment.test.ts` → all pass

### Step 3: Verify no regressions

**Verify**: `bun test src/time-series/` → all pass

## Test plan

- Tests in `src/time-series/alignment.test.ts`
- Cases: mixed frequencies, maxCarryMilliseconds gap, empty predecessor,
  step-after default behavior
- Pattern: `src/time-series/transforms.test.ts`

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun test src/time-series/` exits 0; new tests pass
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts.
- The moving pointer produces different results than the full scan for any
  test case — output must be identical.
- You discover that `entry.points` is not always sorted ascending by effective
  time (the optimization depends on this invariant).

## Maintenance notes

- If `alignTimeSeries` is extended to support non-ascending timelines, the
  moving pointer optimization must be revisited.
- A reviewer should test the chart composer with a correlation study on two
  series with very different frequencies (e.g., daily price + quarterly
  revenue) to confirm correct carry-forward behavior.
