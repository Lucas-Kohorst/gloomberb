# Plan 019: Replace O(n²) mergeStatementsByPeriod with last-group-only check

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat b9d938f..HEAD -- src/time-series/fundamentals.ts`
> If the file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `b9d938f`, 2026-08-17

## Why this matters

`mergeStatementsByPeriod` groups financial statements by nearby period-end dates. It sorts statements by date, then for each statement, scans ALL existing groups via `groups.find()`. Since statements are sorted by date, only the last group can possibly match — adjacent period ends are contiguous. This makes the function O(n²) when it could be O(n). The function is called 3-5 times per fundamental series extraction, which runs per security per chart resolve.

## Current state

`src/time-series/fundamentals.ts:236-254`:

```typescript
function mergeStatementsByPeriod(
  statements: readonly FinancialStatement[],
): InternalStatement[] {
  const groups: InternalStatement[][] = [];
  const sorted = [...statements].sort((left, right) => left.date.localeCompare(right.date));
  for (const statement of sorted) {
    const group = groups.find((candidate) => (
      areNearbyFinancialPeriodEnds(candidate[0]!.date, statement.date)
    ));
    if (group) group.push(statement as InternalStatement);
    else groups.push([statement as InternalStatement]);
  }
  return groups
    .map(mergeStatementPeriodGroup)
    .sort((left, right) => left.date.localeCompare(right.date));
}
```

The same pattern exists in `dedupeFundamentalPeriods` at line ~770 — check and apply the same optimization there.

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Typecheck | `bun run typecheck:opentui`      | exit 0              |
| Tests     | `bun test -- fundamentals`       | all pass            |

## Scope

**In scope**:
- `src/time-series/fundamentals.ts`
- `src/time-series/fundamentals.test.ts` (if it exists — add test if not)

**Out of scope**:
- `areNearbyFinancialPeriodEnds` — do not modify the comparison logic
- `mergeStatementPeriodGroup` — do not modify the merge logic
- Any other file in `src/time-series/`

## Steps

### Step 1: Optimize mergeStatementsByPeriod

Replace the `groups.find()` scan with a check against only the last group:

```typescript
function mergeStatementsByPeriod(
  statements: readonly FinancialStatement[],
): InternalStatement[] {
  const groups: InternalStatement[][] = [];
  const sorted = [...statements].sort((left, right) => left.date.localeCompare(right.date));
  for (const statement of sorted) {
    const lastGroup = groups.at(-1);
    if (lastGroup && areNearbyFinancialPeriodEnds(lastGroup[0]!.date, statement.date)) {
      lastGroup.push(statement as InternalStatement);
    } else {
      groups.push([statement as InternalStatement]);
    }
  }
  return groups
    .map(mergeStatementPeriodGroup)
    .sort((left, right) => left.date.localeCompare(right.date));
}
```

This is safe because:
- Statements are sorted by date ascending
- `areNearbyFinancialPeriodEnds` checks date proximity
- If statement N is not near the last group, it cannot be near any earlier group (which has even earlier dates)

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 2: Apply same optimization to dedupeFundamentalPeriods

Find `dedupeFundamentalPeriods` (around line 770) and apply the same last-group-only pattern if it uses `groups.find()`.

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 3: Run existing tests

**Verify**: `bun test -- fundamentals` → all pass

### Step 4: Full verification

**Verify**: `bun run typecheck` → exit 0, `bun test` → all pass

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun test` exits 0
- [ ] `grep -n "groups.find" src/time-series/fundamentals.ts` returns no matches
- [ ] No files outside scope are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

- `areNearbyFinancialPeriodEnds` does not compare dates monotonically (e.g., it wraps around year boundaries in a way that makes the last-group-only optimization unsafe) — read the function carefully before proceeding.
- `dedupeFundamentalPeriods` uses a different grouping pattern that doesn't match this optimization.

## Maintenance notes

- If `areNearbyFinancialPeriodEnds` is ever changed to allow non-monotonic matching, this optimization would need revisiting.
- The same pattern (sort then check last group only) is safe for any grouping where the match criterion is monotonic in the sort key.
