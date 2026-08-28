# Plan 059: Sandbox the `read_file` plugin tool to allowed roots

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat c01396c5..HEAD -- src/plugins/builtin/ai/tools.ts`
> If the `read_file` tool block changed since this plan was written, compare
> the "Current state" excerpts against the live code before proceeding.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `c01396c5`, 2026-08-26

## Why this matters

The `read_file` plugin tool (in `src/plugins/builtin/ai/tools.ts`, around
line 95) accepts arbitrary absolute paths with no sandboxing:

```typescript
if (relPath.startsWith("/")) {
  fullPath = relPath;
} else {
  fullPath = join(pluginsRoot, relPath);
}
```

This means the AI agent can read **any file on the system** — `~/.ssh/id_rsa`,
`/etc/passwd`, `.env` files, source trees outside the app, anything. The
sibling `write_file` tool is already sandboxed to `~/.gloomberb/plugins/`
with a `startsWith` path-traversal check, but `read_file` has no such
restriction. An agent that can read arbitrary files can exfiltrate secrets,
credentials, and private keys. This is the highest-severity gap in the
plugin tool surface.

## Current state

`src/plugins/builtin/ai/tools.ts` — the `read_file` tool (around line 88):

```typescript
{
  name: "read_file",
  description: "Read a file from ~/.gloomberb/plugins/ or the app source directory.",
  parameters: {
    path: { type: "string", description: "Relative path under ~/.gloomberb/plugins/ or an absolute path", required: true },
  },
  async execute(args): Promise<PluginToolResult> {
    const relPath = String(args.path ?? "");
    if (!relPath) return { success: false, output: "Missing required parameter: path" };

    const pluginsRoot = getPluginsRoot();
    let fullPath: string;
    if (relPath.startsWith("/")) {
      fullPath = relPath;
    } else {
      fullPath = join(pluginsRoot, relPath);
    }

    if (!existsSync(fullPath)) {
      return { success: false, output: `File not found: ${relPath}` };
    }

    try {
      const content = readFileSync(fullPath, "utf-8");
      return { success: true, output: content, data: { path: relPath, size: content.length } };
    } catch (err) {
      return { success: false, output: `Failed to read ${relPath}: ${err}` };
    }
  },
},
```

The `write_file` sandbox pattern to follow (around line 55-75):

```typescript
const pluginsRoot = getPluginsRoot();
const fullPath = join(pluginsRoot, relPath);

// Prevent path traversal outside the plugins directory.
if (!fullPath.startsWith(pluginsRoot)) {
  return { success: false, output: "Path must stay within the plugins directory" };
}
```

`getPluginsRoot()` resolves to `~/.gloomberb/plugins/` (line 71):

```typescript
function getPluginsRoot(): string {
  return process.env.HOME ? join(process.env.HOME, ".gloomberb", "plugins") : join(homedir(), ".gloomberb", "plugins");
}
```

## The fix

Restrict `read_file` to two allowed roots, blocking everything else:

1. **`~/.gloomberb/plugins/`** — the plugins directory (same as `write_file`).
   Reached via a **relative** path.
2. **`process.cwd()`** — the app source directory, so the agent can read the
   app's own source for reference when building plugins. Reached via an
   **absolute** path that resolves under `process.cwd()`.
3. **Block everything else** — any absolute path outside `process.cwd()`
   (e.g. `/etc/passwd`, `~/.ssh/id_rsa`, `/Users/.../.env`) returns an error.

The fix replaces the unconditional acceptance of absolute paths with a
check against the allowed roots, using the same `startsWith` pattern as
`write_file` for path-traversal prevention.

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Typecheck | `npx tsc --noEmit`                | exit 0              |
| Tests     | `bun test src/plugins/builtin/ai/tools.test.ts` | all pass |
| Full suite| `bun test`                       | all pass            |

## Scope

**In scope**:
- `src/plugins/builtin/ai/tools.ts` — fix the `read_file` tool's path resolution

**Out of scope**:
- `src/plugins/builtin/ai/pi/agent-tools.ts` — do not change the agent tool wrapper
- `src/plugins/builtin/ai/pi/host.ts` — do not change the host
- Any other file

## Steps

### Step 1: Replace the absolute-path acceptance with an allowed-roots check

In the `read_file` tool's `execute` body (around line 95-103), replace:

```typescript
const pluginsRoot = getPluginsRoot();
let fullPath: string;
if (relPath.startsWith("/")) {
  fullPath = relPath;
} else {
  fullPath = join(pluginsRoot, relPath);
}
```

with:

```typescript
const pluginsRoot = getPluginsRoot();
const appRoot = process.cwd();
let fullPath: string;

if (relPath.startsWith("/")) {
  // Absolute path: only allow reads under the app source directory.
  fullPath = relPath;
  if (!fullPath.startsWith(appRoot)) {
    return { success: false, output: "Path must stay within the plugins directory or the app source directory" };
  }
} else {
  // Relative path: resolve under the plugins directory.
  fullPath = join(pluginsRoot, relPath);
  if (!fullPath.startsWith(pluginsRoot)) {
    return { success: false, output: "Path must stay within the plugins directory" };
  }
}
```

Notes:
- The `startsWith` check on `fullPath` (after `join`) prevents traversal
  like `../foo` from escaping the plugins root — same pattern `write_file`
  uses.
- The absolute-path branch checks `fullPath.startsWith(appRoot)` where
  `appRoot = process.cwd()`. A path like `/etc/passwd` does not start with
  the app root and is rejected before any read attempt.
- `process.cwd()` is read once at call time, not cached, so it stays correct
  if the working directory changes between calls.

### Step 2: Update the `path` parameter description

Update the `read_file` tool's `parameters.path.description` to reflect the
new contract. Replace:

```typescript
path: { type: "string", description: "Relative path under ~/.gloomberb/plugins/ or an absolute path", required: true },
```

with:

```typescript
path: { type: "string", description: "Relative path under ~/.gloomberb/plugins/, or an absolute path under the app source directory (process.cwd())", required: true },
```

The tool `description` ("Read a file from ~/.gloomberb/plugins/ or the app
source directory.") is already accurate — leave it.

**Verify**: `npx tsc --noEmit` → exit 0

### Step 3: Run the existing tools tests

The existing test suite in `src/plugins/builtin/ai/tools.test.ts` does not
currently exercise `read_file` with absolute paths, so it should pass
unchanged.

**Verify**: `bun test src/plugins/builtin/ai/tools.test.ts` → all pass

### Step 4: Manual verification of the sandbox

Run a one-off Bun script (or `bun -e`) that constructs the tools and calls
`read_file` with each of the four cases below. This is a manual check, not a
committed test — the cases are simple and the behavior is obvious from the
implementation, so per AGENTS.md test guidance we do not add a regression
test.

| Case | `path` arg | Expected |
|------|------------|----------|
| Absolute path outside app root | `/etc/passwd` | `success: false`, output mentions "must stay within" |
| Absolute path to a secret | `~/.ssh/id_rsa` (expand `~`) | `success: false`, output mentions "must stay within" |
| Relative path under plugins dir | `my-plugin/index.ts` (after writing it) | `success: true`, returns content |
| Absolute path under `process.cwd()` | `src/plugins/builtin/ai/tools.ts` | `success: true`, returns content |

For the secret case, expand `~` to the real home directory before passing
it in (the tool receives a literal absolute path; it does not expand `~`
itself, and that is fine — the point is that any absolute path outside
`process.cwd()` is blocked).

**Verify**: all four cases match the expected column.

### Step 5: Full verification

**Verify**:
- `npx tsc --noEmit` → exit 0
- `bun test` → all pass
- `git diff --stat` shows only `src/plugins/builtin/ai/tools.ts` modified

## Done criteria

- [ ] `npx tsc --noEmit` exits 0
- [ ] `bun test` exits 0
- [ ] `read_file` with `/etc/passwd` returns a "must stay within" error
- [ ] `read_file` with an absolute path to `~/.ssh/id_rsa` returns a "must stay within" error
- [ ] `read_file` with a relative path still resolves under `~/.gloomberb/plugins/`
- [ ] `read_file` with an absolute path under `process.cwd()` still works
- [ ] No files outside `src/plugins/builtin/ai/tools.ts` are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

- `read_file` is used by other code that depends on reading arbitrary
  absolute paths. Search:
  `grep -rn "read_file" src/plugins/builtin/ai/ --exclude=tools.test.ts`
  If a caller relies on reading outside `~/.gloomberb/plugins/` or
  `process.cwd()`, stop and report — the allowed-roots set may need to
  expand.
- The `process.cwd()` check would block legitimate plugin-building use
  cases. If the app is normally run from a directory other than its source
  root (e.g. a packaged binary where `process.cwd()` is the user's home,
  not the repo), the "app source for reference" use case breaks. Stop and
  report — the app-source root may need to be resolved from a known
  constant (e.g. `import.meta.dir`-based) rather than `process.cwd()`.
- The `read_file` tool block has been refactored since this plan was written
  (drift check at top) such that the excerpts no longer match.

## Maintenance notes

- The allowed-roots set is intentionally small: plugins dir (writable
  workspace) + app source (read-only reference). Do not add new roots
  casually. If a future feature needs the agent to read from another
  directory, add it as an explicit allowed root with a `startsWith` check,
  and document why.
- `process.cwd()` is read at call time. If the app ever changes its working
  directory at runtime, the allowed app-source root moves with it. That is
  acceptable for the reference use case; if a fixed root is needed, switch
  to a constant derived from `import.meta.dir` or the packaged app path.
- The `write_file` tool remains sandboxed to `~/.gloomberb/plugins/` only.
  Do not loosen it to match `read_file` — writes must stay confined to the
  plugins workspace.
