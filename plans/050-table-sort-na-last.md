# Plan 050: Sort every DataTable; NA / dash always last

> **Executor instructions**: Lift NA-last into `compareSortValues`. Treat
> `null`, `undefined`, `""`, `"—"`, `"-"` as empty. Do not invert nulls when
> multiplying by direction. Skip tables that are naturally ordered (order
> book, strike chain) only if you still bind a **real** sort, not
> `onHeaderClick={() => {}}`.
>
> **Drift check**: `git diff --stat 9016c08e..HEAD -- src/utils/sort-values.ts src/components/data-table src/plugins/builtin/analytics/risk-view.tsx src/plugins/builtin/adjacent/normalize.ts`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `9016c08e`, 2026-08-24

## Why this matters

AGENTS.md: data tables need clickable header sort. User adds: NA/`-` always
sort to the **bottom** regardless of asc/desc.

`compareSortValues` already nulls-last (`src/utils/sort-values.ts:9-11`)
**before** applying direction. Callers that do
`compare × (direction === "desc" ? -1 : 1)` **flip nulls to the top on desc**.
Dash strings sort as `"-"` (rise in asc).

Several tables pass `onHeaderClick={() => {}}` so the header looks
clickable and does nothing.

## Current state

```4:16:src/utils/sort-values.ts
export function compareSortValues(left, right, direction) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  ...
  return direction === "asc" ? comparison : -comparison;
}
```

Empty **not** handled: `"—"`, `"-"`, `""`.

Risk view already documents the desired rule locally
(`analytics/risk-view.tsx` `applyTableSort`).
Sectors: `returnPct ?? Number.NEGATIVE_INFINITY` — last on desc, first on asc.

No-op headers (from audit): options chain, volsurf, corporate actions,
relative valuation, earnings calendar, financials, historical prices,
provider search, alerts, broker manager, BYOK viewer, scanner flow/hilo,
PM trades, PM book.

Related branch `refactor/shared-table-sort` — rebase if it is ahead.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests | `bun test src/utils/sort-values.ts src/plugins/builtin/analytics/risk.test.ts src/plugins/builtin/adjacent/normalize.test.ts` | pass |

## Scope

**In scope**
- `src/utils/sort-values.ts` + tests
- `sortStackItems` / adjacent `compareAdjacentIndexRows` if they invert nulls
- Replace no-op `onHeaderClick` on the list above **or** a shared helper
  `cycleSortPreference` if `refactor/shared-table-sort` already has one
- sector analytics NA handling

**Out of scope**
- Correlation/FX/heatmap canvases
- Inventing sort keys for statement rows that are display-only
- PM main list (already sorts)

## Git workflow

- Branch: `fix/table-sort-na-last`
- Commit: `fix(tables): keep NA and dash rows at the bottom of every sort`

## Steps

### Step 1: Shared empty detection

```ts
function isEmptySortValue(value: SortComparableValue): boolean {
  return value == null || value === "" || value === "-" || value === "—";
}
```

`compareSortValues`: if one side empty → empty last (return 1 / -1)
**independent of direction**.

**Verify**: unit tests asc and desc: `"—"`, `"-"`, `null`, `""` after real
numbers and after `"AAPL"`.

### Step 2: Stop flipping nulls

Grep `sortStackItems` and `* direction` comparators. Adjacent indices
`compareAdjacentIndexRows` + `sortStackItems` is a known invert. Fix so
empty stays last.

**Verify**: adjacent index sort test with a null volume row last on desc.

### Step 3: Wire real header sort on no-op tables

For each no-op file: cycle sort like Adjacent Indices (`onHeaderClick`
toggles asc/desc on that column). Use `compareSortValues` on the cell
sort value (not the display string if the display is `"—"` — pass `null`
from the model).

If a table is a live order book, sort is allowed but default remains
price/time natural order until the user clicks.

**Verify**: one test per plugin is too many. Add sort tests only where
logic is non-obvious (financials, earnings). For pass-through tables,
grep that `onHeaderClick={() => {}}` is gone:

`rg "onHeaderClick=\\{\\(\\) => \\{\\}\\}" src`

## Test plan

- `sort-values` empty last both directions.
- One adjacent / risk regression.
- Pattern: existing `sort-values` tests if any; else create
  `src/utils/sort-values.test.ts`.

## Done criteria

- [ ] `rg "onHeaderClick=\\{\\(\\) => \\{\\}\\}" src` no matches
- [ ] `compareSortValues` empty-last tests for both directions
- [ ] `bun test src/utils/sort-values.ts` passes
- [ ] `plans/README.md` row 050 → DONE

## STOP conditions

- Options chain sort by strike must keep calls/puts grouping — do not
  flatten the chain into a single alpha sort of all cells. If grouping
  conflicts, sort **within** groups only and report.
- `refactor/shared-table-sort` already landed — rebase and only add
  dash/emdash empty handling.

## Maintenance notes

Display `"—"` from `formatNonFinite` (`fix/non-finite-number-formatting`).
Models should pass `null` as the sort value even if the cell shows `"—"`.
