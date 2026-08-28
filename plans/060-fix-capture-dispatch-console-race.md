# Plan 060: Fix captureDispatch console-capture race

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c01396c5..HEAD -- src/plugins/builtin/ai/pi/agent-tools.ts`
> If the file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: correctness / concurrency
- **Planned at**: commit `c01396c5`, 2026-08-26

## Why this matters

`captureDispatch` in `src/plugins/builtin/ai/pi/agent-tools.ts` captures CLI
output by monkeypatching the **global** `console.log`, `console.error`,
`console.info`, and `console.warn` for the duration of each `dispatchCli`
call, then restoring them in a `finally` block.

The agent runtime (pi-agent-core) can issue multiple tool calls
concurrently — `gloomberb_cli` has `executionMode: "sequential"` per tool,
but two separate `gloomberb_cli` tool calls in the same turn can overlap.
When they do, two `captureDispatch` invocations race on the same global
console object:

1. **Output leakage** — both calls push into whichever `lines` array the
   currently-installed `write` closure belongs to. Call A's output lands in
   call B's buffer, and vice versa.
2. **Premature restore** — the first call to finish runs its `finally` and
   restores the original console methods while the second call is still
   running. The second call's `write` is no longer installed, so its output
   goes to the real stdout and is lost from the returned string.
3. **`process.exitCode` clobber** — each call snapshots and restores
   `process.exitCode`. The second call's `finally` restores the value it
   snapshotted (before the first call set it), which can mask a real
   non-zero exit code.

The result is silently wrong CLI tool output and lost errors. This is a
correctness bug, not a perf issue.

## Current state

`src/plugins/builtin/ai/pi/agent-tools.ts` (lines ~80-115):

```typescript
async function captureDispatch(args: string[]): Promise<string> {
  const lines: string[] = [];
  const log = console.log;
  const err = console.error;
  const info = console.info;
  const warn = console.warn;
  const previousExit = process.exitCode;
  const write = (...values: unknown[]) => {
    lines.push(values.map((value) => typeof value === "string" ? value : String(value)).join(" "));
  };
  console.log = write;
  console.info = write;
  console.warn = write;
  console.error = write;
  try {
    const result = await dispatchCli(["--json", ...args]);
    const output = lines.join("\n").trim();
    if (result.kind === "unhandled") {
      throw new Error(`Unknown CLI command: ${args[0]}`);
    }
    return output || JSON.stringify(result);
  } finally {
    console.log = log;
    console.info = info;
    console.warn = warn;
    console.error = err;
    process.exitCode = previousExit;
  }
}
```

`dispatchCli` signature (`src/cli/index.ts`, line 275):

```typescript
export async function dispatchCli(args: string[], options: DispatchCliOptions = {}): Promise<CliDispatchResult>

export interface DispatchCliOptions {
  externalPlugins?: LoadedExternalPlugin[];
}
```

`DispatchCliOptions` has **no** custom stdout/stderr writer. The CLI writes
directly to the global `console.*` methods, so option 1 (pass a custom
writer) would require changing `src/cli/index.ts` and every command's output
path — that is explicitly out of scope. The fix is option 2: serialize
`captureDispatch` calls with an async mutex so the global console is only
ever patched by one call at a time.

## Commands you will need

| Purpose   | Command                                              | Expected on success |
|-----------|------------------------------------------------------|---------------------|
| Typecheck | `npx tsc --noEmit`                                   | exit 0              |
| Tests     | `bun test src/plugins/builtin/ai/pi/agent-tools.test.ts` | all pass        |
| Tests     | `bun test src/plugins/builtin/ai/pi/host.test.ts`    | all pass            |

## Scope

**In scope**:
- `src/plugins/builtin/ai/pi/agent-tools.ts` — add a module-level async mutex and gate `captureDispatch` on it.

**Out of scope**:
- `src/cli/index.ts` — do not change `dispatchCli` or `DispatchCliOptions`.
- Any other file. The mutex lives entirely in `agent-tools.ts`.
- Replacing the console-monkeypatch approach with a custom writer (rejected: `dispatchCli` has no writer parameter; adding one is out of scope).
- Per-call tagged capture buffers (rejected: the global console methods are a single slot; a tag filter does not stop the premature-restore race, only the leakage, and is more complex than the mutex).

## Steps

### Step 1: Add a module-level async mutex

At module scope in `src/plugins/builtin/ai/pi/agent-tools.ts`, above the
`captureDispatch` function, add:

```typescript
// Serializes captureDispatch calls so concurrent CLI tool calls don't race
// on the global console.* methods. dispatchCli has no custom stdout/stderr
// writer, so capture must patch the global console; the mutex guarantees
// only one patch is live at a time.
let cliCaptureMutex: Promise<void> = Promise.resolve();
```

Place it just before `async function captureDispatch(...)`.

### Step 2: Gate captureDispatch on the mutex

Rewrite `captureDispatch` so it acquires the mutex before patching the
console and releases it in the outermost `finally`. The capture logic
itself is unchanged — only the entry/exit is wrapped.

Replace the existing `captureDispatch` with:

```typescript
async function captureDispatch(args: string[]): Promise<string> {
  // Acquire the mutex: wait for any in-flight CLI capture to finish before
  // we touch the global console. This prevents two concurrent calls from
  // corrupting each other's console capture or restoring the console out
  // from under each other.
  const previousMutex = cliCaptureMutex;
  let releaseMutex: () => void = () => {};
  cliCaptureMutex = new Promise<void>((resolve) => {
    releaseMutex = resolve;
  });
  await previousMutex;

  const lines: string[] = [];
  const log = console.log;
  const err = console.error;
  const info = console.info;
  const warn = console.warn;
  const previousExit = process.exitCode;
  const write = (...values: unknown[]) => {
    lines.push(values.map((value) => typeof value === "string" ? value : String(value)).join(" "));
  };
  console.log = write;
  console.info = write;
  console.warn = write;
  console.error = write;
  try {
    const result = await dispatchCli(["--json", ...args]);
    const output = lines.join("\n").trim();
    if (result.kind === "unhandled") {
      throw new Error(`Unknown CLI command: ${args[0]}`);
    }
    return output || JSON.stringify(result);
  } finally {
    console.log = log;
    console.info = info;
    console.warn = warn;
    console.error = err;
    process.exitCode = previousExit;
    releaseMutex();
  }
}
```

Key points:
- `cliCaptureMutex` is reassigned **before** `await previousMutex`, so the
  next caller sees this in-flight promise as the thing to wait on. This is
  the standard promise-chain mutex pattern.
- `releaseMutex()` is called in the same `finally` that restores the
  console, so the mutex is held for exactly the duration of the console
  patch — no longer.
- The mutex is module-level, so it serializes across all `gloomberb_cli`
  tool calls in the process, which is the intent.
- `releaseMutex` is initialized to a no-op so a pathological synchronous
  throw before the `new Promise` line still won't leave the mutex
  unresolved. In practice the assignment is synchronous and cannot throw,
  but the initializer is cheap insurance.

**Verify**: `npx tsc --noEmit` → exit 0

### Step 3: Confirm no deadlock with existing CLI code

The mutex is acquired and released entirely within `captureDispatch`. The
only `await` between acquire and release is `dispatchCli(...)`, which does
not call back into `captureDispatch` or `gloomberb_cli` (CLI commands run
their own command handlers; none re-enter the agent tool layer). So the
mutex cannot deadlock with itself.

If a future CLI command were to invoke a `gloomberb_cli` agent tool
recursively, it would deadlock. That path does not exist today and would
be an architectural error if added. Note it in maintenance notes, do not
guard against it here.

**Verify**: `bun test src/plugins/builtin/ai/pi/agent-tools.test.ts` → all pass
**Verify**: `bun test src/plugins/builtin/ai/pi/host.test.ts` → all pass

### Step 4: Full verification

**Verify**:
- `npx tsc --noEmit` → exit 0
- `bun test src/plugins/builtin/ai/pi/agent-tools.test.ts` → all pass
- `bun test src/plugins/builtin/ai/pi/host.test.ts` → all pass

## Done criteria

- [ ] `npx tsc --noEmit` exits 0
- [ ] `bun test src/plugins/builtin/ai/pi/agent-tools.test.ts` passes
- [ ] `bun test src/plugins/builtin/ai/pi/host.test.ts` passes
- [ ] `captureDispatch` acquires `cliCaptureMutex` before patching `console.*` and releases it in the same `finally` that restores the console
- [ ] `cliCaptureMutex` is reassigned before `await previousMutex` (correct chain order)
- [ ] No files outside `src/plugins/builtin/ai/pi/agent-tools.ts` are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

- `dispatchCli` has grown a custom stdout/stderr writer option since this plan was written. If `DispatchCliOptions` now accepts a writer, stop and reconsider — passing a writer is the better fix (option 1) and the mutex may be unnecessary. Confirm by reading `src/cli/index.ts` `DispatchCliOptions` before starting.
- A mutex already exists in `agent-tools.ts` or `captureDispatch` has already been serialized. Stop if the drift check shows the function is no longer patching the global console.
- The mutex would deadlock: if `dispatchCli` or any CLI command handler it calls can re-enter `captureDispatch` / `gloomberb_cli` synchronously or asynchronously, stop. (Today it cannot; this is a guard against future drift, not an expected condition.)

## Maintenance notes

- The mutex serializes all `gloomberb_cli` calls in the process. This is
  correct for console-capture safety but means CLI tool calls no longer run
  in parallel. That is acceptable: CLI commands are fast and
  `executionMode: "sequential"` already serializes within a single tool.
  If parallel CLI throughput ever matters, the real fix is to give
  `dispatchCli` a custom stdout/stderr writer (option 1) so capture no
  longer needs the global console at all — then the mutex can be removed.
- Do not add a second mutex for a different capture path. There is only one
  `captureDispatch`. If a second console-patching capture appears, give it
  its own mutex or, better, share this one.
- The `process.exitCode` snapshot/restore is still racy in principle across
  non-`captureDispatch` code that sets it, but the mutex makes it safe
  within the CLI-capture path, which is the only path that touches it here.
