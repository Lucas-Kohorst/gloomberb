# Plan 006: Memoize DataTable remote-ui metadata

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7065caf..HEAD -- src/components/ui/data-table/index.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: Plan 004 (the `useRemoteUiNode` dependency array fix should
  land first — this plan's memoization is what makes that fix effective for
  DataTable)
- **Category**: perf
- **Planned at**: commit `7065caf`, 2026-08-16

## Why this matters

`DataTable` passes an inline metadata object to `useRemoteUiNode` that includes
`rows: props.items.slice(0, 200).map(...)`, creating a 200-element array on
every render. Combined with the missing dependency array in `useRemoteUiNode`
(Plan 004), this array is serialized into the remote UI registry on every
commit — every keystroke, scroll, or quote update. For portfolio lists, market
movers, and search results, this is continuous unnecessary work. Memoizing the
metadata object so it's only recomputed when the table data actually changes
eliminates this.

## Current state

**`src/components/ui/data-table/index.tsx`** (lines 21-63):

```typescript
  useRemoteUiNode({
    role: "table",
    label: "Data table",
    actions: {
      selectRow: (input) => {
        const index = resolveTableIndex(input, props);
        const item = index >= 0 ? props.items[index] : undefined;
        if (item) props.onSelect(item, index);
      },
      activateRow: (input) => {
        const index = resolveTableIndex(input, props);
        const item = index >= 0 ? props.items[index] : undefined;
        if (item) {
          props.onSelect(item, index);
          props.onActivate?.(item, index);
        }
      },
      sort: (input) => {
        ...
      },
    },
    metadata: {
      sortColumnId: props.sortColumnId,
      sortDirection: props.sortDirection,
      columns: props.columns.map((column) => ({ id: column.id, label: column.label })),
      rows: props.items.slice(0, 200).map((item, index) => ({
        index,
        key: props.getItemKey(item, index),
        selected: props.isSelected(item, index),
      })),
      rowCount: props.items.length,
    },
  });
```

The `metadata` and `actions` objects, and the entire registration literal, are
recreated on every render.

**Note**: If Plan 004 has already been executed, the registration object is
already wrapped in `useMemo`. In that case, this plan's work may already be
done — verify by checking if `useMemo` is already present. If so, mark this
plan as DONE with a note that 004 covered it.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Install   | `bun install`            | exit 0              |
| Typecheck | `bun run typecheck`      | exit 0, no errors   |
| Tests     | `bun test`               | all pass            |

## Scope

**In scope** (the only files you should modify):
- `src/components/ui/data-table/index.tsx`

**Out of scope** (do NOT touch):
- `src/remote/semantic-tree.tsx` — Plan 004
- Other UI components that call `useRemoteUiNode` — Plan 004 handles those
- The `DataTable` component's rendering logic or props

## Git workflow

- Branch: `advisor/006-datatable-metadata-memoization`
- Commit message: `Memoize DataTable remote-ui metadata to avoid 200-row serialization per render`

## Steps

### Step 1: Wrap the registration in useMemo

Wrap the entire `useRemoteUiNode` argument in `useMemo`:

```typescript
const registration = useMemo(() => ({
  role: "table" as const,
  label: "Data table",
  actions: {
    selectRow: (input: unknown) => { ... },
    activateRow: (input: unknown) => { ... },
    sort: (input: unknown) => { ... },
  },
  metadata: {
    sortColumnId: props.sortColumnId,
    sortDirection: props.sortDirection,
    columns: props.columns.map((column) => ({ id: column.id, label: column.label })),
    rows: props.items.slice(0, 200).map((item, index) => ({
      index,
      key: props.getItemKey(item, index),
      selected: props.isSelected(item, index),
    })),
    rowCount: props.items.length,
  },
}), [
  props.sortColumnId,
  props.sortDirection,
  props.columns,
  props.items,
  props.onSelect,
  props.onActivate,
  props.onHeaderClick,
  props.getItemKey,
  props.isSelected,
]);
useRemoteUiNode(registration);
```

Include every value referenced inside the registration in the dependency array.
If `props.onSelect`, `props.onActivate`, `props.onHeaderClick`, `props.getItemKey`,
or `props.isSelected` are not stable (not wrapped in `useCallback` at the call
site), the memo won't be effective — but that's a caller-side issue and out of
scope. The memo still prevents the 200-row slice/map from running when only
unrelated props change.

**Verify**: `bun run typecheck` → exit 0, no errors

### Step 2: Verify existing tests pass

**Verify**: `bun test` → all pass

## Test plan

- No new tests required — this is a memoization optimization with identical
  behavior. Existing tests serve as regression coverage.

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun test` exits 0 (no regressions)
- [ ] `grep "useRemoteUiNode({" src/components/ui/data-table/index.tsx` returns no matches (inline literal replaced with memoized variable)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts.
- Plan 004 has not been executed yet — this plan's memoization only helps if
  `useRemoteUiNode` has a dependency array. Execute 004 first.
- The `props` values referenced in the registration include functions that are
  not stable across renders and cannot be memoized without touching caller
  files (out of scope) — report back so the scope can be adjusted.

## Maintenance notes

- If DataTable props change to include new fields used in the registration,
  the `useMemo` dependency array must be updated.
- A reviewer should open a portfolio list with 200+ tickers and verify that
  scrolling and selection updates don't cause registry thrash.
