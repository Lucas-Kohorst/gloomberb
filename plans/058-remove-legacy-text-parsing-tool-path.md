# Plan 058: Remove the legacy text-parsing tool path

> **Executor instructions**: Follow this plan step by step. The agent
> protocol (pi-agent-core) already handles tool-use internally. The legacy
> text-parsing path re-executes tools after the agent is done and must be
> removed, not preserved as a fallback.
>
> **Drift check**: `git diff --stat c01396c5..HEAD -- src/plugins/builtin/ai/workspace/pane.tsx src/plugins/builtin/ai/runner.ts src/plugins/builtin/ai/tools.ts`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: existing agent protocol in `pi/host.ts` + `pi/agent-tools.ts` (already on `main`)
- **Category**: bug / dead-code
- **Planned at**: commit `c01396c5`, 2026-08-26

## Why this matters

The workspace pane double-executes tools. It calls `runAiPrompt()` with
`outputMode: "structured"`, which goes through `host.ts` →
`runtime.runAgent()` with typed `AgentTool` objects. The agent protocol
(pi-agent-core) handles tool-use internally: it calls tools, ingests
results, and continues the conversation loop. The final text output is
the agent's response **after** all tool-use is complete.

Then the pane re-parses that final text for ` ```json ` tool-call blocks
using a regex (`parseToolCalls` in `tools.ts`) and executes them **again**.
This is the legacy text-parsing approach from before the agent protocol
was integrated. At best it is a no-op (the agent already consumed its tool
calls and returned prose); at worst it re-runs side-effecting tools
(`write_file`, `list_plugins`) a second time and appends duplicate
`**Tool: ...**` blocks to the transcript.

`runAiWithTools` in `runner.ts` is the same dead pattern: it builds tool
instructions as a text suffix, sends via `runAiPrompt`, then parses the
response with `parseToolCalls`. It is never called by the workspace pane
(which calls `runAiPrompt` directly) or by any other code. It is dead code
that duplicates the agent protocol and misleads future readers into
thinking text-parsing is still a supported path.

## Current state

### Workspace pane — legacy re-parse block

`src/plugins/builtin/ai/workspace/pane.tsx:42`:

```typescript
import { parseToolCalls, executeToolCall, createPluginTools } from "../tools";
```

`src/plugins/builtin/ai/workspace/pane.tsx:578-590` (inside the run handler,
right after `const rawOutput = await controller.done;`):

```typescript
      // Process any tool calls in the AI response.
      let output = rawOutput;
      const toolCalls = parseToolCalls(rawOutput);
      if (toolCalls.length > 0) {
        const tools = createPluginTools(getSharedRegistry());
        const toolResults: string[] = [];
        for (const call of toolCalls) {
          const result = await executeToolCall(tools, call);
          const status = result.success ? "success" : "failed";
          toolResults.push(`**Tool: ${call.tool}** — ${status}\n\`\`\`\n${result.output}\n\`\`\``);
        }
        output = `${rawOutput}\n\n${toolResults.join("\n\n")}`;
      }
```

The agent already executed its tools through the protocol. This block must
go. After removal, `output` is just `rawOutput` — collapse the `let output`
into the downstream usage (the transcript delta and the streamed output
already reference `output`).

### runner.ts — dead `runAiWithTools` + `buildToolInstructions`

`src/plugins/builtin/ai/runner.ts:388-450` (`runAiWithTools`):

```typescript
export function runAiWithTools({
  providerId, prompt, messages, agentMessages, modelId, outputMode, tools,
  onChunk, onAgentMessages, onToolResults,
}: { ... }): AiRunController {
  const toolInstructions = buildToolInstructions(tools);
  const fullPrompt = `${prompt}\n\n${toolInstructions}`;
  const controller = runAiPrompt({ providerId, prompt: fullPrompt, ... });
  const doneWithTools = controller.done.then(async (response) => {
    const { parseToolCalls, executeToolCall } = await import("./tools");
    const calls = parseToolCalls(response);
    if (calls.length === 0) return response;
    const { createPluginTools } = await import("./tools");
    const { getSharedRegistry } = await import("../../registry");
    const pluginTools = createPluginTools(getSharedRegistry());
    ...
    return response + toolOutput;
  });
  return { done: doneWithTools, cancel: controller.cancel };
}
```

`src/plugins/builtin/ai/runner.ts:453-463` (`buildToolInstructions`): only
called by `runAiWithTools` (verified by grep — no other callers in `src/`).

Both must be removed. `runAiWithTools` is exported but has zero importers
(`grep -rn "runAiWithTools" src/` → only its own definition).

### tools.ts — keep, but mark the text-parsing utils deprecated

`src/plugins/builtin/ai/tools.ts` exports `parseToolCalls` (line 38),
`createPluginTools` (line 80), `executeToolCall` (line 274), and a
`processToolCalls` helper (line ~296) that wraps `parseToolCalls` +
`executeToolCall`.

After this plan:
- `createPluginTools` is **still used** by `pi/agent-tools.ts:6,175` to
  build the typed `AgentTool[]` for the protocol. Keep it as-is.
- `parseToolCalls` / `executeToolCall` / `processToolCalls` are only used by
  `tools.test.ts` and by each other. They are no longer on any live path.
  Keep the functions (they are exported utilities and `tools.test.ts`
  covers them) but add a deprecation comment pointing at the agent
  protocol so nobody wires them back in.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Pane tests | `bun test src/plugins/builtin/ai/workspace/pane.test.tsx` | pass |
| Runner tests | `bun test src/plugins/builtin/ai/runner.test.ts` | pass |
| Tools tests (unchanged behavior) | `bun test src/plugins/builtin/ai/tools.test.ts` | pass |
| Full AI plugin suite | `bun test src/plugins/builtin/ai` | pass |
| Residual grep (pane) | `grep -n "parseToolCalls\|executeToolCall\|createPluginTools" src/plugins/builtin/ai/workspace/pane.tsx` | no matches |
| Residual grep (runner) | `grep -n "runAiWithTools\|buildToolInstructions" src/plugins/builtin/ai/runner.ts` | no matches |

## Scope

**In scope**
- `src/plugins/builtin/ai/workspace/pane.tsx` — remove the legacy import (line 42) and the re-parse block (lines ~578-590); collapse `output` to `rawOutput` downstream.
- `src/plugins/builtin/ai/runner.ts` — remove `runAiWithTools` (lines ~388-450) and `buildToolInstructions` (lines ~453-463).
- `src/plugins/builtin/ai/tools.ts` — add deprecation comments on `parseToolCalls`, `executeToolCall`, and `processToolCalls` only. No behavior change.

**Out of scope**
- `src/plugins/builtin/ai/pi/host.ts` — the host is correct; it already routes through `runAgent`.
- `src/plugins/builtin/ai/pi/agent-tools.ts` — the agent tools are correct; `createPluginTools` stays.
- Deleting `parseToolCalls` / `executeToolCall` / `processToolCalls` from `tools.ts` — they stay as deprecated exported utilities (covered by `tools.test.ts`).
- Any change to `tools.test.ts` — the tests still exercise the deprecated utils and should keep passing.

## Git workflow

- Branch: `fix/remove-legacy-text-parsing-tool-path`
- Commit: `fix(ai): remove legacy text-parsing tool path and dead runAiWithTools`
- Land on `fork` (Lucas-Kohorst/gloomberb). Do not target upstream `main`.

## Steps

### Step 1: Remove the legacy re-parse block from the workspace pane

In `src/plugins/builtin/ai/workspace/pane.tsx`, delete the block from the
`// Process any tool calls in the AI response.` comment through the closing
`}` of the `if (toolCalls.length > 0) { ... }` statement (lines ~578-590).

The downstream code currently uses `output` in two places:
1. The `transcriptDelta` assistant message `text: output`.
2. (If present) the streamed/final output state.

After removal, `output` is just `rawOutput`. Collapse it: replace the
`let output = rawOutput;` line and the deleted block with nothing, and change
the downstream `text: output` reference to `text: rawOutput`. Do **not**
leave a dangling `let output = rawOutput;` with no later mutation — either
inline `rawOutput` at the use site or keep a single `const output = rawOutput;`
if the downstream reference is easier to read that way. Prefer inlining.

**Verify**:
```
grep -n "parseToolCalls\|executeToolCall\|createPluginTools" src/plugins/builtin/ai/workspace/pane.tsx
```
→ no matches.

### Step 2: Remove the legacy import from the workspace pane

Delete line 42:

```typescript
import { parseToolCalls, executeToolCall, createPluginTools } from "../tools";
```

Also check whether `getSharedRegistry` (line 43 import) is still used in
`pane.tsx` after the block is gone. If it has no other callers in this file,
remove that import too; if it does, leave it.

**Verify**: `npx tsc --noEmit` → no unused-import error on `pane.tsx`.

### Step 3: Remove `runAiWithTools` from runner.ts

In `src/plugins/builtin/ai/runner.ts`, delete the entire `runAiWithTools`
export (lines ~388-450, from the JSDoc comment ` * This is a simple
text-parsing approach ...` through the closing `}` of the function and its
trailing blank line).

**Verify**:
```
grep -n "runAiWithTools" src/plugins/builtin/ai/runner.ts
```
→ no matches.

### Step 4: Remove `buildToolInstructions` from runner.ts

Delete `buildToolInstructions` (lines ~453-463). It is only called by
`runAiWithTools` (verified: `grep -rn "buildToolInstructions" src/` → only
its own definition and the one call inside `runAiWithTools`, both removed in
Step 3).

**Verify**:
```
grep -n "buildToolInstructions" src/plugins/builtin/ai/runner.ts
```
→ no matches.

### Step 5: Deprecation comments in tools.ts

In `src/plugins/builtin/ai/tools.ts`, prepend a deprecation note to the
JSDoc of `parseToolCalls`, `executeToolCall`, and `processToolCalls`. Do
**not** change their bodies or exports. Example:

```typescript
/**
 * @deprecated Text-parsing tool path. The agent protocol (pi-agent-core)
 * handles tool-use internally via typed AgentTool objects; do not wire this
 * back into a run path. Retained for tools.test.ts coverage only.
 */
```

Leave `createPluginTools` untouched — it is still on the live agent path
(`pi/agent-tools.ts`).

**Verify**: `bun test src/plugins/builtin/ai/tools.test.ts` → pass
(behavior unchanged).

### Step 6: Update plans/README.md

Mark plan 058 row as DONE in `plans/README.md` (add the row if the README
tracks plans by number).

## Test plan

- `npx tsc --noEmit` → exit 0. Watch for: unused imports in `pane.tsx`
  (`parseToolCalls`, `executeToolCall`, `createPluginTools`, possibly
  `getSharedRegistry`), and any leftover references to `runAiWithTools` /
  `buildToolInstructions` in `runner.ts` or its test file.
- `bun test src/plugins/builtin/ai/workspace/pane.test.tsx` → all pass.
  If a test asserted that tool-call blocks get re-executed / appended, that
  test was asserting the buggy behavior and should be removed (per AGENTS.md:
  do not keep tests that protect broken behavior). Note the removal in the
  commit message.
- `bun test src/plugins/builtin/ai/runner.test.ts` → all pass. If a test
  exercised `runAiWithTools` or `buildToolInstructions`, remove it for the
  same reason.
- `bun test src/plugins/builtin/ai/tools.test.ts` → all pass (unchanged).
- `bun test src/plugins/builtin/ai` → full AI plugin suite green.
- Do not add a new test for the removal itself — the absence of double
  execution is covered by the agent protocol tests and the typecheck.

## Done criteria

- [ ] `grep -n "parseToolCalls\|executeToolCall\|createPluginTools" src/plugins/builtin/ai/workspace/pane.tsx` → no matches
- [ ] `grep -n "runAiWithTools\|buildToolInstructions" src/plugins/builtin/ai/runner.ts` → no matches
- [ ] `npx tsc --noEmit` → exit 0
- [ ] `bun test src/plugins/builtin/ai/workspace/pane.test.tsx` → pass
- [ ] `bun test src/plugins/builtin/ai/runner.test.ts` → pass
- [ ] `bun test src/plugins/builtin/ai/tools.test.ts` → pass (deprecation comments only, no behavior change)
- [ ] `createPluginTools` still imported by `pi/agent-tools.ts` (unchanged)
- [ ] `plans/README.md` row 058 → DONE

## STOP conditions

- **If `parseToolCalls` or `executeToolCall` are used elsewhere in the
  workspace pane** besides the block being removed (i.e. grep finds more
  hits than line 42 + the ~578-590 block): stop. Report the extra call sites;
  do not remove them blindly.
- **If removing `runAiWithTools` breaks any import** (e.g. a barrel export
  re-exports it, or `runner.test.ts` imports it): stop. Either remove the
  re-export / test as part of the same change (if the test was asserting the
  dead path) or report the blocker. Do not leave a broken import.
- **If `buildToolInstructions` is used by something other than
  `runAiWithTools`** (grep finds a caller outside the function body): stop.
  Report the caller; do not delete `buildToolInstructions`.
- **If `getSharedRegistry` has other callers in `pane.tsx`** after the block
  is removed: keep its import. Only remove the import if it becomes unused.
- **If `tools.test.ts` fails after the deprecation comments**: the comments
  must be JSDoc-only with no behavior change. Re-check that you did not
  alter a function body.

## Maintenance notes

The agent protocol is the only supported tool path. The text-parsing utils
in `tools.ts` are kept solely so `tools.test.ts` does not rot and so a future
debug parser has something to call, but they must not be wired back into a
run path. The deprecation comments are the guardrail.

If a future provider cannot emit native tool-use and needs a text fallback,
the correct place is a shim inside `pi/host.ts` / `pi/agent-tools.ts` that
translates text tool-call blocks into typed `AgentTool` invocations **before**
handing them to pi-agent-core — not a second execution pass after the agent
is done. Do not resurrect `runAiWithTools` or the pane re-parse block.
