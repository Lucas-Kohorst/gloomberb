# Plan 008: Surface silently swallowed persistence errors

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7065caf..HEAD -- src/plugins/builtin/notes/quick-notes-pane.tsx src/plugins/builtin/notes/ticker-notes-tab.tsx src/plugins/builtin/notes/index.tsx src/app/runtime/startup.ts src/brokers/sync-broker-instance.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `7065caf`, 2026-08-16

## Why this matters

Multiple persistence paths silently swallow errors with `.catch(() => {})` or
empty `catch {}` blocks. If the filesystem write fails (disk full, permissions
change, data directory removed), the user's notes or broker account data are
silently lost — the UI shows no error and the user assumes the save succeeded.
Replacing these with logged errors (and user-visible warnings where appropriate)
prevents silent data loss.

## Current state

**Notes persistence** — `src/plugins/builtin/notes/quick-notes-pane.tsx`:
- Line 36: `notesFiles.saveQuickNotesIndex(entries).catch(() => {});`
- Line 50: `notesFiles.save(notesFiles.quickNoteKey(tabId), text).catch(() => {});`
- Line 146: `notesFiles.delete(notesFiles.quickNoteKey(id)).catch(() => {});`

**Notes persistence** — `src/plugins/builtin/notes/ticker-notes-tab.tsx`:
- Line 32: same `.catch(() => {})` pattern

**Notes persistence** — `src/plugins/builtin/notes/index.tsx`:
- Line 22: same `.catch(() => {})` pattern

**Broker account loading** — `src/app/runtime/startup.ts`:
- Line 78: `} catch {}` wraps `loadPersistedBrokerAccountMap(...)` — app
  silently continues with empty broker accounts if load fails.

**Broker account persistence** — `src/brokers/sync-broker-instance.ts`:
- Line 141: `} catch {}` wraps `persistBrokerAccounts(...)` after successful sync
- Line 150: same pattern in error-recovery branch

**Convention**: The codebase uses `console.error` or scoped loggers for error
reporting. For user-facing errors in panes, `ctx.notify()` is the standard
pattern (see PLUGINS.md). For startup/internal modules, `console.error` or
the scoped logger is appropriate. Check if a logger is already available in
each module's scope before introducing one.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Install   | `bun install`            | exit 0              |
| Typecheck | `bun run typecheck`      | exit 0, no errors   |
| Tests     | `bun test`               | all pass            |

## Scope

**In scope** (the only files you should modify):
- `src/plugins/builtin/notes/quick-notes-pane.tsx`
- `src/plugins/builtin/notes/ticker-notes-tab.tsx`
- `src/plugins/builtin/notes/index.tsx`
- `src/app/runtime/startup.ts`
- `src/brokers/sync-broker-instance.ts`

**Out of scope** (do NOT touch):
- The `notesFiles` API itself (`src/plugins/builtin/notes/notes-files.ts` or
  similar) — only the call sites change
- Any other `.catch(() => {})` patterns elsewhere in the codebase — those are
  separate findings if they exist
- The broker sync logic — only the catch blocks change

## Git workflow

- Branch: `advisor/008-surface-swallowed-errors`
- Commit message: `Surface silently swallowed persistence errors in notes and broker modules`

## Steps

### Step 1: Replace swallowed errors in notes panes

For each `.catch(() => {})` in the notes files, replace with error logging:

```typescript
// Before:
notesFiles.save(notesFiles.quickNoteKey(tabId), text).catch(() => {});

// After:
notesFiles.save(notesFiles.quickNoteKey(tabId), text).catch((error) => {
  console.error("[notes] Failed to save note:", error);
});
```

For the notes panes (quick-notes-pane.tsx, ticker-notes-tab.tsx), if a
notification mechanism is available in the component scope (check for
`usePluginAppActions` or a `notify` function), also surface a user-visible
toast on save failure:

```typescript
notesFiles.save(...).catch((error) => {
  console.error("[notes] Failed to save note:", error);
  // If notify is available:
  notify?.({ body: "Failed to save note. Check disk space and permissions.", type: "error" });
});
```

Only add the `notify` call if a notification function is already in scope or
can be obtained via existing hooks without significant refactoring. If not,
the `console.error` alone is sufficient for this plan.

**Verify**: `bun run typecheck` → exit 0, no errors

### Step 2: Replace swallowed errors in broker modules

In `src/app/runtime/startup.ts` line 78:

```typescript
// Before:
} catch {}

// After:
} catch (error) {
  console.error("[startup] Failed to load persisted broker accounts:", error);
}
```

In `src/brokers/sync-broker-instance.ts` lines 141 and 150:

```typescript
// Before:
try {
  persistBrokerAccounts(resources, instance, broker, brokerAccounts);
} catch {}

// After:
try {
  persistBrokerAccounts(resources, instance, broker, brokerAccounts);
} catch (error) {
  console.error("[broker-sync] Failed to persist broker accounts:", error);
}
```

**Verify**: `bun run typecheck` → exit 0, no errors

### Step 3: Verify existing tests pass

**Verify**: `bun test` → all pass

## Test plan

- No new tests required — these are error-logging additions that don't change
  the happy path. The existing test suite confirms no behavior regression.
- If a test specifically asserts that errors are swallowed (e.g., tests that
  the catch returns silently), update it to reflect the new logging behavior.

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun test` exits 0 (no regressions)
- [ ] `grep -rn "catch () {}" src/plugins/builtin/notes/ src/app/runtime/startup.ts src/brokers/sync-broker-instance.ts` returns no matches
- [ ] `grep -rn "catch {}" src/plugins/builtin/notes/ src/app/runtime/startup.ts src/brokers/sync-broker-instance.ts` returns no matches
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts.
- A notes pane file uses a different persistence API than `notesFiles.save` /
  `notesFiles.delete` / `notesFiles.saveQuickNotesIndex` — report the actual
  API and adjust.
- The startup or broker modules already have error logging that was added
  since this plan was written.

## Maintenance notes

- A future improvement would be to surface persistence errors in the pane
  footer (via `usePaneFooter`) rather than just console logging — but that
  requires more UI work and is out of scope here.
- A reviewer should test by making the data directory read-only and verifying
  that errors appear in the console (and toast, if implemented).
