# Plan 005: Replace mergePriceHistoryWindows re-sort with two-pointer merge

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7065caf..HEAD -- src/time-series/resolve.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `7065caf`, 2026-08-16

## Why this matters

`mergePriceHistoryWindows()` builds a `Map` from all current + incoming price
points, then sorts the entire result array. It is called inside `loadHistory()`
which runs inside `resolveChartSpecData()` on every chart resolution. As price
history accumulates across chart pan/zoom operations and live quote updates
trigger re-resolution, each merge re-sorts the full set — O(n log n) repeated
work. Since both `current` and `incoming` are already sorted by timestamp, a
standard two-pointer merge produces the same result in O(n).

## Current state

**`src/time-series/resolve.ts`** — `mergePriceHistoryWindows` (lines 352-371):

```typescript
function mergePriceHistoryWindows(
  current: TickerFinancials["priceHistory"],
  incoming: TickerFinancials["priceHistory"],
): TickerFinancials["priceHistory"] {
  const byTimestamp = new Map<number, TickerFinancials["priceHistory"][number]>();
  for (const point of [...current, ...incoming]) {
    const timestamp = getPricePointTimestamp(point);
    if (Number.isFinite(timestamp)) {
      byTimestamp.set(
        timestamp,
        point.date instanceof Date ? point : { ...point, date: new Date(timestamp) },
      );
    }
  }
  return [...byTimestamp.values()].sort(
    (left, right) => getPricePointTimestamp(left) - getPricePointTimestamp(right),
  );
}
```

Key behaviors to preserve:
1. Deduplication by timestamp (incoming overrides current for the same timestamp)
2. Points without a finite timestamp are dropped
3. Points without a `Date` instance get one created from the timestamp
4. Result is sorted ascending by timestamp

**Convention**: Pure functions, explicit types. Tests in `src/time-series/resolve.test.ts`
if it exists, otherwise create one.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Install   | `bun install`            | exit 0              |
| Typecheck | `bun run typecheck`      | exit 0, no errors   |
| Tests     | `bun test src/time-series/` | all pass         |

## Scope

**In scope** (the only files you should modify):
- `src/time-series/resolve.ts`
- `src/time-series/resolve.test.ts` (add tests if file exists; create if not)

**Out of scope** (do NOT touch):
- `src/time-series/transforms.ts` — Plan 002
- `src/time-series/alignment.ts` — Plan 003
- Any caller of `mergePriceHistoryWindows` — the function signature does not change

## Git workflow

- Branch: `advisor/005-merge-history-optimization`
- Commit message: `Optimize mergePriceHistoryWindows from O(n log n) sort to O(n) merge`

## Steps

### Step 1: Replace Map+sort with two-pointer merge

Rewrite `mergePriceHistoryWindows` to use a two-pointer merge:

1. Both `current` and `incoming` are sorted ascending by timestamp. If they
   are not guaranteed sorted, add an assertion or sort them first (but the
   callers produce sorted output — verify by reading `loadHistory` and the
   price history fetch path).
2. Walk both arrays with two pointers. At each step, compare timestamps:
   - If `current[ci]` timestamp < `incoming[ii]` timestamp: take current, advance ci
   - If `incoming[ii]` timestamp < `current[ci]` timestamp: take incoming, advance ii
   - If equal: take incoming (override behavior), advance both
3. For each taken point, apply the same finite-timestamp check and Date
   normalization as the current code.
4. Append remaining points from whichever array has leftovers.

The output must be identical: deduplicated, normalized, sorted ascending.

**Verify**: `bun run typecheck` → exit 0, no errors

### Step 2: Add tests

Add tests to `resolve.test.ts` (create if it doesn't exist):

- Merge two non-overlapping sorted windows — verify correct ordering
- Merge with overlapping timestamps — verify incoming overrides current
- Merge with a point missing a Date instance — verify Date is created
- Merge with a point having non-finite timestamp — verify it's dropped
- Merge empty current with non-empty incoming — verify result equals incoming (normalized)
- Merge two empty arrays — verify empty result

Export `mergePriceHistoryWindows` for testing if it isn't already exported
(check for a `__testInternals` export pattern or add one).

**Verify**: `bun test src/time-series/resolve.test.ts` → all pass

### Step 3: Verify no regressions

**Verify**: `bun test src/time-series/` → all pass

## Test plan

- Tests in `src/time-series/resolve.test.ts`
- Cases: non-overlapping, overlapping (override), Date normalization, non-finite
  timestamp drop, empty inputs
- Pattern: `src/time-series/transforms.test.ts`

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun test src/time-series/` exits 0; new tests pass
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts.
- `current` or `incoming` is not guaranteed to be sorted ascending by timestamp
  — the two-pointer merge depends on this. If unsorted, the plan needs to
  add a sort step first (which negates the optimization — report back).
- The function is not exportable for testing without major refactoring.

## Maintenance notes

- If a future change produces unsorted price history windows, this optimization
  breaks silently (output would be unsorted). Consider adding a debug assertion
  that the inputs are sorted.
- A reviewer should pan/zoom a chart with accumulated history and verify smooth
  performance.
