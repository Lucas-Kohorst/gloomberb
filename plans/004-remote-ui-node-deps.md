# Plan 004: Add dependency array to useRemoteUiNode effect

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7065caf..HEAD -- src/remote/semantic-tree.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `7065caf`, 2026-08-16

## Why this matters

`useRemoteUiNode` in `src/remote/semantic-tree.tsx` has a `useEffect` with no
dependency array, so it runs after every render. It calls
`registry.register(nodeId, registration)` or `registry.unregister(nodeId)` on
every commit. There are 13 call sites (data-table, list-view, button, tabs,
fields, message-composer, etc.). Every re-render — keystroke, scroll, quote
update — re-registers all semantic nodes, churning the registry that the
remote controller snapshots to build the semantic tree.

Adding a dependency array keyed on the registration object identity will
ensure registration only happens when the registration actually changes. This
is marked MED risk because many callers pass inline registration literals that
create a new object every render — those callers need `useMemo` to make the
dependency array effective.

## Current state

**`src/remote/semantic-tree.tsx`** — `useRemoteUiNode` (lines 88-110):

```typescript
export function useRemoteUiNode(registration: RemoteUiNodeRegistration | null | undefined): string | null {
  const registry = useRemoteUiRegistry();
  const generatedId = useId();
  const nodeId = useMemo(() => `ui:${generatedId.replace(/:/g, "")}`, [generatedId]);

  useEffect(() => {
    if (!registry) return;
    if (!registration) {
      registry.unregister(nodeId);
      return;
    }
    registry.register(nodeId, registration);
  });  // <-- NO dependency array

  useEffect(() => {
    return () => registry?.unregister(nodeId);
  }, [
    nodeId,
    registry,
  ]);
```

Call sites that pass inline registration objects (will need `useMemo`):
- `src/components/ui/data-table/index.tsx` — inline `{ role, label, actions, metadata }`
- `src/components/ui/list-view.tsx` — inline registration
- `src/components/ui/button.tsx` — inline registration
- `src/components/ui/tabs.tsx` — inline registration
- Other UI components under `src/components/ui/`

**Convention**: React hooks follow standard `useEffect` dependency array rules.
The codebase uses `useMemo` for expensive objects (see `src/market-data/hooks.ts`
for examples of `useMemo` with keyed dependencies).

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Install   | `bun install`            | exit 0              |
| Typecheck | `bun run typecheck`      | exit 0, no errors   |
| Tests     | `bun test`               | all pass            |

## Scope

**In scope** (the only files you should modify):
- `src/remote/semantic-tree.tsx`
- `src/components/ui/data-table/index.tsx` — wrap `useRemoteUiNode` arg in `useMemo`
- `src/components/ui/list-view.tsx` — same (if it passes inline registration)
- `src/components/ui/button.tsx` — same
- `src/components/ui/tabs.tsx` — same
- Any other file under `src/components/ui/` that calls `useRemoteUiNode` with an inline object — search for `useRemoteUiNode({` to find them all

**Out of scope** (do NOT touch):
- `src/components/ui/data-table/index.tsx` metadata content (Plan 006 handles that separately)
- The `RemoteUiRegistry` class itself — only the hook changes
- Plugin code that calls `useRemoteUiNode` through wrappers — these use the shared UI components

## Git workflow

- Branch: `advisor/004-remote-ui-node-deps`
- Commit message: `Add dependency array to useRemoteUiNode effect and memoize caller registrations`

## Steps

### Step 1: Add dependency array to the registration effect

In `src/remote/semantic-tree.tsx`, add `[registry, nodeId, registration]` to
the first `useEffect`:

```typescript
  useEffect(() => {
    if (!registry) return;
    if (!registration) {
      registry.unregister(nodeId);
      return;
    }
    registry.register(nodeId, registration);
  }, [registry, nodeId, registration]);
```

**Verify**: `bun run typecheck` → exit 0, no errors

### Step 2: Memoize inline registration objects in callers

Search for all call sites passing inline objects to `useRemoteUiNode`:

```
grep -rn "useRemoteUiNode({" src/components/ src/plugins/
```

For each call site, wrap the registration object in `useMemo` with appropriate
dependencies. For example, in `src/components/ui/data-table/index.tsx`:

```typescript
const registration = useMemo(() => ({
  role: "table",
  label: "Data table",
  actions: { selectRow: ..., activateRow: ..., sort: ... },
  metadata: { sortColumnId, sortDirection, columns, rows, rowCount },
}), [props.sortColumnId, props.sortDirection, props.columns, props.items, props.onSelect, props.onActivate, props.onHeaderClick]);
useRemoteUiNode(registration);
```

The exact dependencies will vary per call site — include every value referenced
inside the registration object.

**Verify**: `bun run typecheck` → exit 0, no errors

### Step 3: Verify existing tests pass

**Verify**: `bun test` → all pass

If any test breaks, it likely depends on the re-registration behavior. Investigate
whether the test is testing real behavior or an implementation detail.

## Test plan

- No new tests required — this is a performance optimization with identical
  behavior. Existing tests serve as regression coverage.
- If existing tests break, they are testing the re-registration side effect
  and should be updated to reflect the corrected behavior.

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun test` exits 0 (no regressions)
- [ ] `grep -A2 "useRemoteUiNode" src/remote/semantic-tree.tsx` shows a dependency array on the registration effect
- [ ] `grep -rn "useRemoteUiNode({" src/components/` returns no results (all callers now pass a memoized variable)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts.
- A call site's registration object references values that can't be memoized
  (e.g., functions created inline that aren't wrapped in `useCallback`) —
  report the file and the specific values.
- Adding the dependency array causes more than 3 test failures that can't be
  resolved by updating the test to reflect the corrected behavior.
- You discover that the registry depends on re-registration for correctness
  (e.g., it diffs registrations to detect changes) — in that case, the fix
  approach needs to change.

## Maintenance notes

- New UI components calling `useRemoteUiNode` must pass a memoized registration
  object, not an inline literal. Consider adding a lint rule or a comment
  in `semantic-tree.tsx` documenting this requirement.
- Plan 006 (DataTable metadata memoization) builds on this — if executing
  both, do 004 first.
- A reviewer should open the remote control panel and verify that semantic
  nodes still appear and update correctly when navigating lists and tables.
