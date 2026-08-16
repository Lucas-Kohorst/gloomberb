# Plan 014: Add race-condition tests for sync controller

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7065caf..HEAD -- src/sync/controller.ts src/sync/controller.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `7065caf`, 2026-08-16

## Why this matters

The sync controller is the core of Gloom Cloud state synchronization. Its
`syncOnce()` method has a complex pull-then-push sequence with `isCurrent()`
guards between each async step. The existing tests cover basic contributor
registration, push/pull ordering, and error states — but none cover race
conditions: runtime swap mid-pull, contributor apply failure mid-iteration,
concurrent `requestSync` queuing, or stale-snapshot overwrite. A race condition
could cause silent data loss (e.g., a pull applying a stale snapshot over
newer local state, or a push sending incomplete contributor data).

## Current state

**`src/sync/controller.ts`** — `syncOnce()` (lines 176-225):

```typescript
  private async syncOnce(options: { reason?: string; force?: boolean }): Promise<void> {
    const runtime = this.runtime;
    if (!runtime) return;
    const registration = runtime.getTransport();
    if (!registration?.transport.isAvailable()) {
      this.setStatus({ phase: "disabled", ... });
      return;
    }
    const transport = registration.transport;

    if (!this.hasPulledForTransport.has(transport.id)) {
      this.lastSignature = null;
      if (!await this.runPull(runtime, transport)) return;
      if (!this.isCurrent(runtime, transport)) return;  // guard after pull
      this.hasPulledForTransport.add(transport.id);
    }

    const snapshot = await this.assembleSnapshot(runtime);
    if (!this.isCurrent(runtime, transport)) return;  // guard after snapshot
    const signature = snapshotContentSignature(snapshot);
    if (!options.force && signature === this.lastSignature) return;

    this.setStatus({ phase: "syncing", ... });
    try {
      const result = await transport.pushSnapshot(snapshot, { baseRevision: this.status.revision });
      if (!this.isCurrent(runtime, transport)) return;  // guard after push
      ...
    } catch (error) {
      if (!this.isCurrent(runtime, transport)) return;
      ...
    }
  }
```

`requestSync()` (lines 157-170):

```typescript
  async requestSync(options: { reason?: string; force?: boolean } = {}): Promise<void> {
    if (this.inFlight) {
      this.syncQueued = true;
      return this.inFlight;
    }
    const run = this.syncOnce(options).finally(async () => {
      if (this.inFlight !== run) return;
      this.inFlight = null;
      if (!this.syncQueued) return;
      this.syncQueued = false;
      await this.requestSync({ reason: "queued-state-change" });
    });
    this.inFlight = run;
    return run;
  }
```

`runPull()` (lines 227+) iterates contributors and applies payloads with
`isCurrent()` guards between each contributor.

**`src/sync/controller.test.ts`** — existing tests (221 lines) cover:
- Basic contributor registration
- Push/pull ordering
- Error states (transport failure)
- Signature-based skip

**Convention**: Tests use `bun:test` with manual async control. See
`src/sync/controller.test.ts` for the pattern — it creates mock transports,
contributors, and runtime objects. The test file uses `MockSyncTransport` and
helper functions to set up sync scenarios.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Install   | `bun install`            | exit 0              |
| Typecheck | `bun run typecheck`      | exit 0, no errors   |
| Tests     | `bun test src/sync/controller.test.ts` | all pass |

## Scope

**In scope** (the only files you should modify):
- `src/sync/controller.test.ts` (add tests only — do not modify existing tests)

**Out of scope** (do NOT touch):
- `src/sync/controller.ts` — the implementation is not changing; these are
  characterization tests to document and verify existing behavior
- `src/sync/core-contributors.ts` — separate module
- Any other sync files

## Git workflow

- Branch: `advisor/014-sync-race-tests`
- Commit message: `Add race-condition tests for sync controller`

## Steps

### Step 1: Read the existing test helpers and mock patterns

Read `src/sync/controller.test.ts` fully. Understand:
- How `MockSyncTransport` is constructed (what methods it exposes, how to
  control pull/push responses)
- How contributors are registered and how their `apply` is invoked
- How `SyncRuntime` is mocked (the `isCurrent()` check, `getTransport()`,
  `getState()`, `getContributors()`)

**Verify**: `bun test src/sync/controller.test.ts` → all existing tests pass

### Step 2: Add test — runtime swap mid-pull

Test scenario: while `runPull()` is iterating contributors (between contributor
A and B), the runtime changes (e.g., user switches transport). The `isCurrent()`
guard after each contributor should prevent applying contributor B's payload.

Implementation:
1. Create a transport and two contributors (A, B).
2. Make contributor A's `apply` resolve immediately.
3. Make contributor B's `apply` hang on a controllable promise.
4. Start `requestSync()`.
5. While B is pending, swap the runtime (call whatever method changes the
   transport/runtime — check `setRuntime()` or `updateRuntime()`).
6. Resolve B's `apply` promise.
7. Verify B's `apply` was called but the result was NOT applied (the
   `isCurrent()` guard returned false and `runPull` returned false).
8. Verify the push phase was skipped.

**Verify**: `bun test src/sync/controller.test.ts` → new test passes

### Step 3: Add test — contributor apply failure mid-iteration

Test scenario: contributor B's `apply` throws during pull. The pull should
abort and the error should be surfaced in the sync status.

1. Create two contributors (A, B).
2. Contributor A's `apply` succeeds.
3. Contributor B's `apply` throws an Error.
4. Start `requestSync()`.
5. Verify `runPull` returns false (or the sync aborts).
6. Verify the status reflects the error.

**Verify**: `bun test src/sync/controller.test.ts` → new test passes

### Step 4: Add test — concurrent requestSync queuing

Test scenario: `requestSync()` is called while a sync is in flight. The second
call should queue and execute after the first completes.

1. Start a sync with a controllable transport (pull hangs on a promise).
2. Call `requestSync()` again while the first is in flight.
3. Verify `syncQueued` is true and the second call returns the first's promise.
4. Resolve the first sync's pull.
5. Verify the queued sync fires and completes.

**Verify**: `bun test src/sync/controller.test.ts` → new test passes

### Step 5: Add test — stale snapshot signature skip

Test scenario: after a pull, the assembled snapshot has the same signature as
the last push. The push should be skipped (no `pushSnapshot` call).

1. Run a full sync cycle (pull + push) and capture the signature.
2. Without changing state, call `requestSync()` again.
3. Verify `pushSnapshot` is NOT called (signature matches).
4. Call `requestSync({ force: true })`.
5. Verify `pushSnapshot` IS called (force bypasses signature check).

**Verify**: `bun test src/sync/controller.test.ts` → new test passes

### Step 6: Verify full suite

**Verify**: `bun test src/sync/` → all pass

## Test plan

- All tests in `src/sync/controller.test.ts`
- Cases: runtime swap mid-pull, contributor apply failure, concurrent queuing,
  stale signature skip + force override
- Pattern: existing tests in the same file (MockSyncTransport, mock contributors)

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun test src/sync/controller.test.ts` exits 0; at least 4 new tests pass
- [ ] `bun test src/sync/` exits 0 (no regressions)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts.
- The existing test infrastructure (MockSyncTransport, mock runtime) doesn't
  support the level of async control needed for these tests — report what's
  missing so the helpers can be extended.
- `isCurrent()` or the runtime swap mechanism works differently than described
  — report the actual mechanism so the test scenarios can be adjusted.
- A race condition test reveals an actual bug in the controller — report the
  bug with the failing test case. Do not fix the controller (out of scope).

## Maintenance notes

- These tests document the intended behavior of the sync controller's race
  guards. If the guards are refactored, these tests verify the behavior is
  preserved.
- If a test reveals an actual race condition bug, the fix should be a separate
  plan — these tests are characterization tests, not bug fixes.
- A reviewer should read each test and confirm it exercises a real race
  scenario, not just a sequential flow with extra steps.
