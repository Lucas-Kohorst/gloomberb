# Plan 068: Fix three `--data-dir` / `GLOOMBERB_DATA_DIR` isolation bypasses

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 09e9b9a3..HEAD -- src/plugins/builtin/ai/run-trace.ts src/plugins/builtin/ai/tools.ts src/cli/options.ts src/plugins/loader.ts src/data/config/store/node.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `09e9b9a3`, 2026-08-29

## Why this matters

`--data-dir` / `GLOOMBERB_DATA_DIR` is the isolation mechanism for test, CI,
and multi-profile sessions. Three code paths bypass it: (A) the AI run-trace
directory is resolved at import time from `homedir()`, so trace files always
land under `~/.gloomberb/ai-runs` regardless of the override; (B) the AI plugin
tools `getPluginsRoot()` reads `process.env.HOME` directly instead of the
canonical `getPluginsDir()` resolver, so file writes target the wrong plugins
directory; (C) `applyDataDirFromArgs` accepts the next raw arg unconditionally
as the `--data-dir` value, so `--data-dir --headless` silently sets the data
dir to the literal string `--headless`. Each leak defeats isolation and can
corrupt or pollute the real `~/.gloomberb` tree.

## Current state

> **CRITICAL BASELINE WARNING.** This repo's CI is currently RED on `main`. At
> clean HEAD `09e9b9a3` the baseline is **91 failing tests** and **27-29
> typecheck errors per sub-project** (`bun run typecheck` exits 2). These
> failures are **PRE-EXISTING and NOT caused by your change.** Do NOT attempt to
> fix them — that is `plans/072-ci-baseline-repair.md`'s job. Before you start,
> record your own baseline:
>
> ```sh
> bun test 2>&1 | tail -5
> bun run typecheck 2>&1 | tail -20
> ```
>
> Your done criteria is that you do not **increase** these counts, not that they
> reach zero. If you see a large number of unrelated failures, that is expected —
> do not treat it as a signal that your change broke something.

### Canonical resolver (the pattern to follow)

**`src/plugins/loader.ts`** — `getPluginsDir()` (lines 23-30). Lazy resolution
on first call, honoring `GLOOMBERB_DATA_DIR`:

```ts
let pluginsDir: string | null = null;

export function getPluginsDir(): string {
  // GLOOMBERB_DATA_DIR has to cover external plugins too, or an "isolated"
  // session still loads whatever the developer has installed under $HOME and a
  // locally installed plugin can collide with a built-in module id.
  pluginsDir ??= process.env.GLOOMBERB_DATA_DIR
    ? join(process.env.GLOOMBERB_DATA_DIR, "plugins")
    : join(process.env.HOME || homedir(), ".gloomberb", "plugins");
  return pluginsDir;
}
```

**`src/data/config/store/node.ts`** — `getDataDir()` (lines 31-37). Same
pattern: checks `GLOOMBERB_DATA_DIR` first:

```ts
export async function getDataDir(): Promise<string | null> {
  // GLOOMBERB_DATA_DIR overrides everything — no need to read the global
  // config or redirect HOME for test/CI isolation.
  const envDir = process.env.GLOOMBERB_DATA_DIR;
  if (envDir) return envDir;
  // ... falls back to config.json / ~/.gloomberb
}
```

### Defect A: AI run-trace directory resolved at import time

**`src/plugins/builtin/ai/run-trace.ts`** — lines 1-12:

```ts
import { mkdirSync, writeFileSync, appendFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const DEFAULT_RUNS_DIR = join(homedir(), ".gloomberb", "ai-runs");
const PREVIEW_CHARS = 4_000;

let runsDirOverride: string | null = null;

export function getAiRunsDir(): string {
  return runsDirOverride ?? DEFAULT_RUNS_DIR;
}
```

`DEFAULT_RUNS_DIR` is computed at module-import time from `homedir()`, before
`applyDataDirFromArgs` or `process.env.GLOOMBERB_DATA_DIR` has a chance to run.
The `runsDirOverride` is only set by `setAiRunsDirForTests` (a test-only
escape hatch). So in production, `getAiRunsDir()` always returns
`~/.gloomberb/ai-runs` even when `GLOOMBERB_DATA_DIR` is set.

### Defect B: AI plugin tools bypass the canonical resolver

**`src/plugins/builtin/ai/tools.ts`** — `getPluginsRoot()` (lines 77-79):

```ts
function getPluginsRoot(): string {
  return process.env.HOME ? join(process.env.HOME, ".gloomberb", "plugins") : join(homedir(), ".gloomberb", "plugins");
}
```

This reads `process.env.HOME` directly and constructs the path manually,
ignoring `GLOOMBERB_DATA_DIR`. The canonical resolver `getPluginsDir()` is
already imported at the top of this file (line 7):

```ts
import { resolvePluginEntryFile, getPluginsDir } from "../../loader";
```

So the fix is to replace `getPluginsRoot()` calls with `getPluginsDir()`.

### Defect C: `applyDataDirFromArgs` accepts next flag as value

**`src/cli/options.ts`** — `applyDataDirFromArgs` (lines 42-56):

```ts
export function applyDataDirFromArgs(rawArgs: readonly string[]): void {
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--data-dir") {
      const value = rawArgs[index + 1];
      if (value) process.env.GLOOMBERB_DATA_DIR = value;
      return;
    }
    if (arg?.startsWith("--data-dir=")) {
      const value = arg.slice("--data-dir=".length);
      if (value) process.env.GLOOMBERB_DATA_DIR = value;
      return;
    }
  }
}
```

The `if (value)` check only guards against `undefined` (end of args). It does
NOT guard against the next arg being another flag (e.g. `--headless`). So
`gloomberb --data-dir --headless` sets `GLOOMBERB_DATA_DIR` to the literal
string `--headless`.

The later `parseCliGlobalArgs` (lines 113-121) does it correctly — it throws
on missing values:

```ts
if (arg === "--data-dir") {
  index += 1;
  const value = rawArgs[index];
  if (!value) throw new Error("Missing value for --data-dir.");
  options.dataDir = value;
  process.env.GLOOMBERB_DATA_DIR = value;
  continue;
}
```

### Test conventions

Tests use `bun:test` (`describe`, `expect`, `test` from `"bun:test"`). See
`src/brokers/require-valid-broker.test.ts` for a structural example. Test
files live next to the source file with `.test.ts` suffix. No test file exists
for `src/cli/options.ts` yet — this plan creates one.

### Repo conventions

- `GLOOMBERB_DATA_DIR` is the canonical isolation env var. Every path that
  derives from `~/.gloomberb` must check it. The lazy-resolution pattern
  (`dir ??= env ? join(env, ...) : join(home, ...)`) is the established
  convention — see `getPluginsDir()` in `src/plugins/loader.ts:23-30`.
- `homedir()` from `os` is the fallback for `process.env.HOME` being unset.
- The `--limit` flag in `parseCliGlobalArgs` throws on a missing value
  (`parseLimit` at line 31: `if (!value) throw new Error("Missing value for --limit.")`).
  The `--data-dir` flag in `parseCliGlobalArgs` does the same (line 116).
  `applyDataDirFromArgs` should follow the same guard pattern.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Install   | `bun install`            | exit 0              |
| Typecheck | `bun run typecheck`      | exit 0, no errors   |
| Tests     | `bun test src/cli/options.test.ts` | all pass   |
| Full test | `bun test`               | exit 0, all pass    |

## Scope

**In scope** (the only files you should modify):
- `src/plugins/builtin/ai/run-trace.ts` — fix Defect A
- `src/plugins/builtin/ai/tools.ts` — fix Defect B
- `src/cli/options.ts` — fix Defect C
- `src/cli/options.test.ts` — create, test for Defect C

**Out of scope** (do NOT touch):
- `src/plugins/loader.ts` — `getPluginsDir()` is the canonical resolver; it is
  already correct. Do not modify it.
- `src/data/config/store/node.ts` — `getDataDir()` is already correct.
- `src/cli/entry.ts` — calls `applyDataDirFromArgs`; no change needed there.
- Any other file that reads `GLOOMBERB_DATA_DIR` — only the three defects above
  are in scope.

## Git workflow

- Branch: `advisor/068-data-dir-isolation-bypasses`
- Commit message style: `fix: <description>` (conventional commits, matching
  recent history like `fix(chat): drop unused kind inference…`)
- One commit per defect or a single commit for all three — either is fine.

## Steps

### Step 1: Fix Defect A — make `getAiRunsDir()` honor `GLOOMBERB_DATA_DIR`

In `src/plugins/builtin/ai/run-trace.ts`:

1. Remove the import-time `const DEFAULT_RUNS_DIR = join(homedir(), ".gloomberb", "ai-runs");`
2. Replace `getAiRunsDir()` with lazy resolution that checks
   `GLOOMBERB_DATA_DIR` first, following the `getPluginsDir()` pattern:

```ts
import { mkdirSync, writeFileSync, appendFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const PREVIEW_CHARS = 4_000;

let runsDirOverride: string | null = null;
let defaultRunsDir: string | null = null;

function resolveDefaultRunsDir(): string {
  defaultRunsDir ??= process.env.GLOOMBERB_DATA_DIR
    ? join(process.env.GLOOMBERB_DATA_DIR, "ai-runs")
    : join(homedir(), ".gloomberb", "ai-runs");
  return defaultRunsDir;
}

export function getAiRunsDir(): string {
  return runsDirOverride ?? resolveDefaultRunsDir();
}

export function setAiRunsDirForTests(dir: string | null): void {
  runsDirOverride = dir;
  defaultRunsDir = null;
}
```

Note: `setAiRunsDirForTests` must also reset `defaultRunsDir = null` so that
tests which set `GLOOMBERB_DATA_DIR` before calling `getAiRunsDir()` get the
correct value. The `homedir()` import stays — it is still the fallback.

**Verify**: `bun run typecheck` → exit 0, no errors

### Step 2: Fix Defect B — replace `getPluginsRoot()` with `getPluginsDir()`

In `src/plugins/builtin/ai/tools.ts`:

1. Delete the `getPluginsRoot()` function (lines 77-79):

```ts
function getPluginsRoot(): string {
  return process.env.HOME ? join(process.env.HOME, ".gloomberb", "plugins") : join(homedir(), ".gloomberb", "plugins");
}
```

2. Replace all calls to `getPluginsRoot()` with `getPluginsDir()`. Search
   for every call site:

```
grep -n "getPluginsRoot" src/plugins/builtin/ai/tools.ts
```

3. Remove the now-unused `homedir` import if no other code in the file uses
   it. Check with:

```
grep -n "homedir" src/plugins/builtin/ai/tools.ts
```

If `homedir` is only used by the deleted `getPluginsRoot()`, remove it from
the import on line 4: `import { homedir } from "os";`. If other code still
uses it, leave the import.

**Verify**: `bun run typecheck` → exit 0, no errors

**Verify**: `grep -n "getPluginsRoot" src/plugins/builtin/ai/tools.ts` → no matches

### Step 3: Fix Defect C — guard `applyDataDirFromArgs` against flag-as-value

In `src/cli/options.ts`, update `applyDataDirFromArgs` (lines 42-56):

```ts
export function applyDataDirFromArgs(rawArgs: readonly string[]): void {
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--data-dir") {
      const value = rawArgs[index + 1];
      if (value && !value.startsWith("-")) {
        process.env.GLOOMBERB_DATA_DIR = value;
      }
      return;
    }
    if (arg?.startsWith("--data-dir=")) {
      const value = arg.slice("--data-dir=".length);
      if (value) process.env.GLOOMBERB_DATA_DIR = value;
      return;
    }
  }
}
```

The key change: `if (value && !value.startsWith("-"))` — if the next arg
starts with `-`, it is another flag, not a directory path. We silently skip
rather than throw because `applyDataDirFromArgs` runs before full parsing
and should not abort the process. The later `parseCliGlobalArgs` will throw
the proper "Missing value for --data-dir." error.

**Verify**: `bun run typecheck` → exit 0, no errors

### Step 4: Create `src/cli/options.test.ts`

Create `src/cli/options.test.ts` with tests for `applyDataDirFromArgs`:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { applyDataDirFromArgs, parseCliGlobalArgs } from "./options";

const ENV_KEY = "GLOOMBERB_DATA_DIR";

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe("applyDataDirFromArgs", () => {
  test("sets GLOOMBERB_DATA_DIR from --data-dir <value>", () => {
    applyDataDirFromArgs(["--data-dir", "/tmp/test-data"]);
    expect(process.env[ENV_KEY]).toBe("/tmp/test-data");
  });

  test("sets GLOOMBERB_DATA_DIR from --data-dir=<value>", () => {
    applyDataDirFromArgs(["--data-dir=/tmp/test-data"]);
    expect(process.env[ENV_KEY]).toBe("/tmp/test-data");
  });

  test("does NOT set GLOOMBERB_DATA_DIR when next arg is a flag", () => {
    applyDataDirFromArgs(["--data-dir", "--headless"]);
    expect(process.env[ENV_KEY]).toBeUndefined();
  });

  test("does NOT set GLOOMBERB_DATA_DIR when --data-dir is last arg", () => {
    applyDataDirFromArgs(["--data-dir"]);
    expect(process.env[ENV_KEY]).toBeUndefined();
  });

  test("does NOT set GLOOMBERB_DATA_DIR when --data-dir is absent", () => {
    applyDataDirFromArgs(["--headless", "--json"]);
    expect(process.env[ENV_KEY]).toBeUndefined();
  });
});

describe("parseCliGlobalArgs", () => {
  test("throws on missing --data-dir value", () => {
    expect(() => parseCliGlobalArgs(["--data-dir"])).toThrow("Missing value for --data-dir.");
  });

  test("sets dataDir and GLOOMBERB_DATA_DIR from --data-dir <value>", () => {
    delete process.env[ENV_KEY];
    const result = parseCliGlobalArgs(["--data-dir", "/tmp/test-data"]);
    expect(result.options.dataDir).toBe("/tmp/test-data");
    expect(process.env[ENV_KEY]).toBe("/tmp/test-data");
    delete process.env[ENV_KEY];
  });
});
```

**Verify**: `bun test src/cli/options.test.ts` → all tests pass

### Step 5: Full verification

**Verify**: `bun run typecheck` → exit 0, no errors

**Verify**: `bun test` → exit 0, all pass (including new tests)

**Verify**: `grep -n "getPluginsRoot" src/plugins/builtin/ai/tools.ts` → no matches

**Verify**: `grep -n "DEFAULT_RUNS_DIR" src/plugins/builtin/ai/run-trace.ts` → no matches (the import-time constant is gone; the lazy resolver uses `defaultRunsDir`)

## Test plan

- New tests in `src/cli/options.test.ts` covering:
  - `--data-dir <value>` sets env (happy path)
  - `--data-dir=<value>` sets env (equals form)
  - `--data-dir --headless` does NOT set env (the bug this plan fixes)
  - `--data-dir` as last arg does NOT set env (missing value)
  - No `--data-dir` present does NOT set env
  - `parseCliGlobalArgs` throws on missing `--data-dir` value
  - `parseCliGlobalArgs` sets both `options.dataDir` and env from `--data-dir <value>`
- Structural pattern: `src/brokers/require-valid-broker.test.ts` (uses
  `bun:test` `describe`/`test`/`expect`)

## Done criteria

- [ ] `bun run typecheck` error count is **not higher** than the baseline you
      recorded at the start (it will NOT exit 0 — baseline is 27-29 errors per
      sub-project; that is plan 072's problem, not yours)
- [ ] `bun test` failure count is **not higher** than the baseline you recorded
      at the start (baseline ~91; it will NOT exit 0)
- [ ] New tests in `src/cli/options.test.ts` pass:
      `bun test src/cli/options.test.ts` → all pass
- [ ] `grep -rn "getPluginsRoot" src/` returns no matches
- [ ] `grep -n "const DEFAULT_RUNS_DIR" src/plugins/builtin/ai/run-trace.ts` returns no matches
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts
  (the codebase has drifted since this plan was written).
- `getPluginsDir` is not exported from `src/plugins/loader.ts` — the import
  in `tools.ts` line 7 would fail. Report so the plan can be adjusted.
- `getPluginsRoot()` is called from files other than `src/plugins/builtin/ai/tools.ts`
  — those call sites would also need updating. Check with
  `grep -rn "getPluginsRoot" src/` before starting.
- The `homedir` import in `tools.ts` is used by other functions besides
  `getPluginsRoot` — do not remove it blindly; check first.
- A step's verification fails twice after a reasonable fix attempt.
- Test or typecheck counts **increase** above the baseline you recorded at the
  start. Do not chase the pre-existing failures down to zero.

## Maintenance notes

- When adding any new `~/.gloomberb`-derived path, use the lazy-resolution
  pattern: check `GLOOMBERB_DATA_DIR` first, fall back to `homedir()`. Never
  resolve at import time. See `getPluginsDir()` in `src/plugins/loader.ts`
  as the canonical example.
- The `applyDataDirFromArgs` function is intentionally silent on bad values
  (it runs before full parsing). The full parser `parseCliGlobalArgs` throws
  on missing `--data-dir` values. Do not add throwing to
  `applyDataDirFromArgs` — it would abort the process before the full parser
  can produce a helpful error message.
- A reviewer should verify that the `!value.startsWith("-")` guard in
  `applyDataDirFromArgs` does not reject legitimate paths starting with `-`.
  On macOS/Linux, directory paths starting with `-` are extremely rare and
  would require escaping in the shell anyway. The `--data-dir=` equals form
  handles such edge cases.
- Future: consider centralizing all `~/.gloomberb` path resolution into a
  single module that always checks `GLOOMBERB_DATA_DIR`, so individual files
  cannot bypass isolation by accident.
