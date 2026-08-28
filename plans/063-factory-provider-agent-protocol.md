# Plan 063: Switch the Factory provider onto the agent protocol (`runAgent`)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat c01396c5..HEAD -- src/plugins/builtin/ai/pi/host.ts src/plugins/builtin/ai/factory/provider.ts src/plugins/builtin/ai/pi/runtime.ts`
> If the Factory provider branch in `host.ts` (around line 573) or the
> `streamFactory` function in `factory/provider.ts` changed since this plan
> was written, compare the "Current state" excerpts against the live code
> before proceeding.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (one branch in `host.ts`; the underlying stream is unchanged)
- **Depends on**: existing `runtime.runAgent` + agent-tools (already on `main`)
- **Category**: agents / protocol parity
- **Planned at**: 2026-08-26, `origin/main` @ `c01396c5`

## Why this matters

The Factory provider (`FACTORY_PROVIDER_ID = "factory"`) is the only AI
provider that bypasses the agent protocol. In `host.ts` the Factory branch
calls `runtime.runText()`:

```typescript
if (runOptions.providerId === FACTORY_PROVIDER_ID) {
  return runOrTrace(runtime.runText({
    providerId: runOptions.providerId,
    modelId: runOptions.modelId,
    prompt: runOptions.prompt,
    messages: factoryConversationMessages(runOptions),
    systemPrompt: FACTORY_AGENT_SYSTEM_PROMPT,
    onChunk: runOptions.onChunk,
    onThinking: runOptions.onThinking,
  }));
}
```

`runText` is a single text completion. It never invokes the agent core, so:

1. The `onAgentMessages` callback is never called — the workspace pane cannot
   record the Factory turn in its `agentMessages` transcript, so a Factory
   turn produces no tool-call cards (plan 061) and no replayable history.
2. The Pi runtime never sees tool calls, so there is no tracing/visibility
   into the run from the agent layer (the droid exec subprocess writes its
   own trace, but that is a separate artifact the workspace does not read).
3. The agent is given no Pi-layer tools. The `FACTORY_AGENT_SYSTEM_PROMPT`
   tells it to "Write files, then they can be reloaded," but the only file
   tools that exist (`createAgentPluginFileTools`, `createAgentCliTool`,
   `createAgentShowTool`, `createRemoteTool`) are wired exclusively in the
   `structured` and `screener` branches.

Every other provider that runs in `structured` mode goes through
`runtime.runAgent()` and gets the full tool set plus `onAgentMessages`.
The Factory provider is the lone exception. This plan closes that gap.

## What is already true (do not rebuild)

| Piece | Where | Use it |
|---|---|---|
| `runtime.runAgent` | `pi/runtime.ts` `runAgent(request)` | returns `{ text, messages: [userMessage, ...resultMessages] }` and drives the pi-agent-core `Agent` loop |
| Structured tool set | `host.ts` structured branch (lines 615-645) | `createRemoteTool`, `createAgentCliTool`, `createAgentShowTool`, `createAgentPluginFileTools()` |
| `onAgentMessages` plumbing | `runner.ts` → `host.ts:641` calls `runOptions.onAgentMessages?.(normalizeAiAgentHistory(result.messages))` | pane captures it into `completedAgentMessages` |
| `factoryConversationMessages` | `host.ts:365` | flattens `agentMessages`/`messages` into `PiConversationMessage[]` for the Factory prompt |
| `FACTORY_AGENT_SYSTEM_PROMPT` | `factory/provider.ts` | the plugin-authoring system prompt; reused unchanged |

## The critical finding (read before implementing)

The Factory provider does **not** stream a tool-use loop. `streamFactory` in
`factory/provider.ts` spawns `droid exec` (`runDroidExec`), waits for the
subprocess to finish, then pushes **one** text chunk and ends with
`stopReason: "stop"`:

```typescript
const result = await runDroidExec(model, prompt, signal);
const finalMessage = buildAssistantMessage(model, result, "stop");
stream.push({ type: "text_start", ... });
stream.push({ type: "text_delta", ..., delta: result, ... });
stream.push({ type: "text_end", ... });
stream.push({ type: "done", reason: "stop", message: finalMessage });
stream.end(finalMessage);
```

The droid exec subprocess does its own tool-use internally (it has its own
tools and agent loop) and returns a single final text response. The Pi
`streamSimple` therefore returns exactly one assistant message whose
`stopReason` is always `"stop"`, never `"toolUse"`.

This means `runtime.runAgent()` on the Factory provider is **mechanically
safe but functionally a no-op for Pi-layer tool-use**:

- The pi-agent-core `Agent` calls `streamSimple` once, receives the droid
  exec text with `stopReason: "stop"`, sees no `toolCall` content blocks, and
  ends the loop after a single iteration. The Pi-layer tools
  (`gloomberb_cli`, `gloomberb_show`, `gloomberb_remote`, file tools) are
  advertised to the agent but **never invoked**, because the underlying
  model response never requests a tool call.
- There is **no double execution**: droid exec runs once (inside
  `streamFactory`); the Pi agent core does not re-run anything. It just
  consumes the single response.
- `streamFactory` ignores `context.tools` entirely — `extractPrompt` only
  serializes `systemPrompt` + `messages`, never the tool definitions — so
  the droid exec subprocess never even sees the Pi tools. They are dead
  weight on the Pi side, present for interface parity and future use.

**The real, immediate benefit of this change is visibility, not
tool-use**: switching to `runAgent` wires `onAgentMessages`, so the
workspace pane receives the normalized `[user, assistant]` transcript for
the Factory turn. That transcript is what plan 061 (tool-call cards) and
the transcript persistence (`appendLocalAgentTranscript`) read from. Today
a Factory turn leaves `completedAgentMessages` empty, so the pane stores
nothing and plan 061 has nothing to render. After this change, the Factory
turn is recorded like any other structured turn.

True Pi-layer tool-use for the Factory provider (letting the Pi agent call
`gloomberb_cli` etc. directly) would require `streamFactory` to surface
droid exec's internal tool calls as `toolUse` stop reasons and feed the
tool results back through the subprocess. That is a larger change to
`factory/provider.ts`, which is **out of scope** for this plan. This plan
takes the parity/visibility win now and leaves deeper subprocess-tool
bridging to a future plan.

## Current state

`src/plugins/builtin/ai/pi/host.ts` — the Factory branch (around line 573):

```typescript
if (runOptions.providerId === FACTORY_PROVIDER_ID) {
  return runOrTrace(runtime.runText({
    providerId: runOptions.providerId,
    modelId: runOptions.modelId,
    prompt: runOptions.prompt,
    messages: factoryConversationMessages(runOptions),
    systemPrompt: FACTORY_AGENT_SYSTEM_PROMPT,
    onChunk: runOptions.onChunk,
    onThinking: runOptions.onThinking,
  }));
}
```

The structured branch immediately below it (around line 615) is the
template to follow:

```typescript
if (runOptions.outputMode === "structured") {
  const run = runtime.runAgent({
    providerId: runOptions.providerId,
    modelId: runOptions.modelId,
    prompt: runOptions.prompt,
    messages: runOptions.messages,
    agentMessages: runOptions.agentMessages,
    systemPrompt: NATIVE_AGENT_SYSTEM_PROMPT,
    tools: [
      createRemoteTool({
        appKind: options.appKind,
        dataDir: options.dataDir,
        sendRequest: sendRemoteRequest,
      }),
      createAgentCliTool(),
      createAgentShowTool(sendRemoteRequest, {
        appKind: options.appKind,
        dataDir: options.dataDir,
      }),
      ...createAgentPluginFileTools(),
    ],
    onChunk: runOptions.onChunk,
    onThinking: runOptions.onThinking,
  });
  return runOrTrace({
    done: run.done.then((result) => {
      runOptions.onAgentMessages?.(normalizeAiAgentHistory(result.messages));
      return result.text;
    }),
    cancel: run.cancel,
  });
}
```

`runtime.runAgent` signature (`pi/runtime.ts`):

```typescript
runAgent(request: PiAgentRunRequest): PiRunController<PiAgentRunResult>
// PiAgentRunRequest: { providerId, modelId?, prompt, messages?, agentMessages?,
//   systemPrompt?, tools?, onChunk?, onThinking?, onEvent? }
// PiAgentRunResult: { text: string, messages: AgentMessage[] }
```

## The fix

Replace the Factory branch's `runtime.runText(...)` call with a
`runtime.runAgent(...)` call that mirrors the structured branch: same
`FACTORY_AGENT_SYSTEM_PROMPT`, the same four tool constructors, the
`onAgentMessages` callback wired to `runOptions.onAgentMessages`, and the
`onChunk`/`onThinking` callbacks. The conversation history continues to
flow through `factoryConversationMessages` (the Factory prompt builder
flattens `agentMessages` into text turns, which is still correct for the
droid exec prompt — see "Why `messages` not `agentMessages`" below).

### Why `messages` (not `agentMessages`) for the Factory branch

The structured branch passes both `messages: runOptions.messages` and
`agentMessages: runOptions.agentMessages` to `runAgent`. For the Factory
provider we must keep passing the **flattened** `factoryConversationMessages`
as `messages`, **not** the raw `agentMessages`:

- `streamFactory` → `extractPrompt(context)` serializes `context.messages`
  into the droid exec prompt file. It does not understand `toolCall` /
  `toolResult` content blocks — only text. `factoryConversationMessages`
  already flattens `agentMessages` into `{ role, content: string }` text
  turns, which is exactly what `extractPrompt` consumes.
- If we passed raw `agentMessages` (with `toolCall`/`toolResult` blocks)
  to `runAgent`, the pi-agent-core `Agent` would seed its state with those
  structured messages, but `streamFactory` would then re-serialize
  `context.messages` (which `runAgent` rebuilds from `messages` +
  `agentMessages` via `toPiMessages` + `toPiAgentMessages`) and the
  `toolCall` blocks would be dropped by `extractPrompt`'s text-only
  `messageText` filter anyway. Passing the already-flattened
  `factoryConversationMessages` as `messages` keeps the droid exec prompt
  identical to today.
- We do **not** pass `agentMessages` to `runAgent` for the Factory branch.
  The Factory provider has no Pi-layer tool history to replay (its tool-use
  happens inside droid exec, invisible to Pi), so there is no structured
  agent history to seed. The flattened text history in `messages` is the
  full conversation context.

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Typecheck | `npx tsc --noEmit`                | exit 0              |
| Tests     | `bun test src/plugins/builtin/ai/pi/host.test.ts` | all pass |
| Grep check| `grep -n "FACTORY_PROVIDER_ID" src/plugins/builtin/ai/pi/host.ts` | the branch uses `runAgent`, not `runText` |
| Full suite| `bun test`                       | all pass            |

## Scope

**In scope**:
- `src/plugins/builtin/ai/pi/host.ts` — replace the Factory provider branch
  (`runtime.runText` → `runtime.runAgent` with tools + `onAgentMessages`).
- `src/plugins/builtin/ai/pi/host.test.ts` — update the existing Factory
  test ("Factory structured runs as plugin-authoring text, not
  remote-control tools") which currently asserts `runText` is used and
  `runAgent` throws. It must now assert the opposite: `runAgent` is used
  with the structured tool set and `onAgentMessages` is invoked.

**Out of scope**:
- `src/plugins/builtin/ai/factory/provider.ts` — do not change the provider
  definition or `streamFactory`. The single-response stream stays as-is.
- `src/plugins/builtin/ai/pi/runtime.ts` — do not change `runAgent`.
- `src/plugins/builtin/ai/pi/agent-tools.ts` — do not change existing tools.
- Any other file.

## Steps

### Step 1: Replace the Factory branch with `runAgent`

In `src/plugins/builtin/ai/pi/host.ts`, replace the Factory branch (around
line 573-583):

```typescript
if (runOptions.providerId === FACTORY_PROVIDER_ID) {
  return runOrTrace(runtime.runText({
    providerId: runOptions.providerId,
    modelId: runOptions.modelId,
    prompt: runOptions.prompt,
    messages: factoryConversationMessages(runOptions),
    systemPrompt: FACTORY_AGENT_SYSTEM_PROMPT,
    onChunk: runOptions.onChunk,
    onThinking: runOptions.onThinking,
  }));
}
```

with:

```typescript
if (runOptions.providerId === FACTORY_PROVIDER_ID) {
  const run = runtime.runAgent({
    providerId: runOptions.providerId,
    modelId: runOptions.modelId,
    prompt: runOptions.prompt,
    messages: factoryConversationMessages(runOptions),
    systemPrompt: FACTORY_AGENT_SYSTEM_PROMPT,
    tools: [
      createRemoteTool({
        appKind: options.appKind,
        dataDir: options.dataDir,
        sendRequest: sendRemoteRequest,
      }),
      createAgentCliTool(),
      createAgentShowTool(sendRemoteRequest, {
        appKind: options.appKind,
        dataDir: options.dataDir,
      }),
      ...createAgentPluginFileTools(),
    ],
    onChunk: runOptions.onChunk,
    onThinking: runOptions.onThinking,
  });
  return runOrTrace({
    done: run.done.then((result) => {
      runOptions.onAgentMessages?.(normalizeAiAgentHistory(result.messages));
      return result.text;
    }),
    cancel: run.cancel,
  });
}
```

Notes:
- The tool set is identical to the `structured` branch — interface parity.
  The tools are advertised to the pi-agent-core `Agent`, but because
  `streamFactory` always returns `stopReason: "stop"` with no `toolCall`
  blocks, the agent loop ends after one iteration and none of these tools
  are ever invoked (see "The critical finding"). They are present for
  parity and so a future plan that bridges droid exec tool calls can light
  them up without touching `host.ts` again.
- `onAgentMessages` is now invoked with
  `normalizeAiAgentHistory(result.messages)`, where `result.messages` is
  `[userMessage, ...resultMessages]` from `runAgent`. For the Factory
  provider this is `[user, assistant(text)]` — no tool calls, because droid
  exec returns plain text. The workspace pane records the turn.
- `factoryConversationMessages(runOptions)` stays as the `messages` source
  so the droid exec prompt is byte-identical to today (see "Why `messages`
  not `agentMessages`").
- `onChunk` and `onThinking` are wired through unchanged. `streamFactory`
  emits one `text_delta` with the full result, so `onChunk` fires once
  with the complete text (same observable behavior as `runText`).

**Verify**: `npx tsc --noEmit` → exit 0

### Step 2: Update the existing Factory host test

The test at `src/plugins/builtin/ai/pi/host.test.ts` (around line 274,
"Factory structured runs as plugin-authoring text, not remote-control
tools") currently asserts the opposite of the new behavior:

```typescript
runText: (request: { systemPrompt?: string; prompt: string }) => {
  received.push(request);
  return { done: Promise.resolve("wrote plugin"), cancel() {} };
},
runAgent: () => {
  throw new Error("Factory should not use the remote-control agent loop");
},
```

...and asserts `received[0]?.systemPrompt` contains "plugin author" and
the run resolves to `"wrote plugin"`.

Flip it to assert the new contract: the Factory provider uses `runAgent`
with the structured tool set and invokes `onAgentMessages`. Replace the
test body with:

```typescript
test("Factory structured run goes through runAgent with structured tools and onAgentMessages", async () => {
  const received: Array<{
    systemPrompt?: string;
    prompt: string;
    tools?: { name: string }[];
  }> = [];
  const agentMessages: unknown[] = [];
  const runtime = {
    getProviderSummary: async () => ({
      id: "factory" as const,
      label: "Factory",
      name: "Factory",
      defaultModelId: "claude-opus-5",
      authMethods: [],
      connection: {
        state: "connected" as const,
        type: "api_key" as const,
        source: "droid CLI",
        origin: "external" as const,
        disconnectable: false,
      },
      models: [],
    }),
    runAgent: (request: {
      systemPrompt?: string;
      prompt: string;
      tools?: { name: string }[];
    }) => {
      received.push(request);
      return {
        done: Promise.resolve({
          text: "wrote plugin",
          messages: [
            { role: "user", content: "can you build / edit plugins", timestamp: 0 },
            {
              role: "assistant",
              content: [{ type: "text", text: "wrote plugin" }],
              api: "pi-messages",
              provider: "factory",
              model: "claude-opus-5",
              usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
              stopReason: "stop",
              timestamp: 1,
            },
          ],
        }),
        cancel() {},
      };
    },
    runText: () => {
      throw new Error("Factory should use runAgent, not runText");
    },
  };
  const host = createPiAiHost({
    appKind: "desktop",
    dataDir: "/tmp/gloomberb-pi-host-factory-test",
    runtime: runtime as never,
  });

  await expect(host.run({
    providerId: "factory",
    prompt: "can you build / edit plugins",
    outputMode: "structured",
    onAgentMessages: (messages) => agentMessages.push(messages),
  }).done).resolves.toBe("wrote plugin");

  expect(received).toHaveLength(1);
  expect(received[0]?.systemPrompt).toContain("plugin author");
  expect(received[0]?.prompt).toBe("can you build / edit plugins");
  const toolNames = received[0]?.tools?.map((tool) => tool.name);
  expect(toolNames).toContain("gloomberb_remote");
  expect(toolNames).toContain("gloomberb_cli");
  expect(toolNames).toContain("gloomberb_show");
  expect(toolNames).toContain("write_file");
  expect(toolNames).toContain("read_file");
  expect(agentMessages).toHaveLength(1);
  expect((agentMessages[0] as Array<{ role: string }>)[0]?.role).toBe("user");
  expect((agentMessages[0] as Array<{ role: string }>)[1]?.role).toBe("assistant");
});
```

Notes:
- The fake `runAgent` returns a `{ text, messages }` result shaped like
  the real `PiAgentRunResult`. The `messages` array is a minimal
  `[user, assistant]` pair mirroring what `streamFactory` produces (one
  text assistant turn, no tool calls).
- The test asserts the four structured tools are advertised
  (`gloomberb_remote`, `gloomberb_cli`, `gloomberb_show`, plus file tools
  `write_file`/`read_file` from `createAgentPluginFileTools`).
- The test asserts `onAgentMessages` was invoked once with a
  `[user, assistant]` transcript. This is the visibility win.
- `runText` now throws if called — the Factory branch must not fall back
  to it.

**Verify**: `bun test src/plugins/builtin/ai/pi/host.test.ts` → all pass

### Step 3: Confirm the branch uses `runAgent`

**Verify**: `grep -n "FACTORY_PROVIDER_ID" src/plugins/builtin/ai/pi/host.ts`
— the Factory branch must reference `runtime.runAgent`, not
`runtime.runText`. There should be no remaining `runtime.runText` call
inside the `FACTORY_PROVIDER_ID` branch.

### Step 4: Full verification

**Verify**:
- `npx tsc --noEmit` → exit 0
- `bun test` → all pass
- `git diff --stat` shows only `src/plugins/builtin/ai/pi/host.ts` and
  `src/plugins/builtin/ai/pi/host.test.ts` modified

## Tests worth keeping

Per AGENTS.md: keep tests only for non-obvious behavior with a real
regression risk.

- **Keep (and flip) the Factory host test** (Step 2): it guards the
  protocol-parity contract — Factory goes through `runAgent`, gets the
  structured tool set, and fires `onAgentMessages`. This is the exact
  behavior this plan establishes and the most likely thing to silently
  regress (someone reverts to `runText` for "simplicity"). The flipped
  test is non-obvious: it asserts both the tool advertisement *and* the
  `onAgentMessages` callback, neither of which is visible from reading
  the branch in isolation.

Skip: a test that only asserts the `FACTORY_AGENT_SYSTEM_PROMPT` string is
passed through (obvious from the branch) or that `factoryConversationMessages`
is called (pass-through wiring).

## Done criteria

- [ ] `npx tsc --noEmit` exits 0
- [ ] `bun test src/plugins/builtin/ai/pi/host.test.ts` passes
- [ ] `bun test` exits 0
- [ ] The Factory branch in `host.ts` calls `runtime.runAgent` (not
  `runText`) with the structured tool set and `onAgentMessages` wired
- [ ] The existing Factory host test is flipped to assert `runAgent` +
  `onAgentMessages` and passes
- [ ] No files outside `host.ts` and `host.test.ts` are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

- **`streamFactory` no longer returns a single text response.** If a
  concurrent change to `factory/provider.ts` makes `streamFactory` emit
  `toolUse` stop reasons or stream multiple assistant turns, then
  `runAgent` would actually execute the Pi-layer tools and the
  double-execution / double-tool-use concern becomes real. Run the drift
  check at the top; if `streamFactory` changed, stop and re-evaluate — the
  "mechanically safe, no double execution" finding in this plan depends on
  the single-`stop`-response contract.
- **`runtime.runAgent` requires a model that declares tool-use support and
  the Factory models do not.** The Factory models are declared with
  `factoryModel(...)` in `factory/provider.ts` and do not set any
  tool-use capability flag. If `runAgent`/`resolveModel` rejects a model
  without a tool-use capability when tools are supplied, the Factory
  branch would throw at runtime. Verify by checking `PiAiRuntime.runAgent`
  and `resolveModel` in `pi/runtime.ts` — currently neither inspects a
  tool-use capability flag (tools are passed straight to the
  pi-agent-core `Agent`), so this is expected to pass. If a capability
  gate was added since this plan was written, stop and report.
- **The droid exec subprocess already handles all tool-use and adding Pi
  tools causes double execution.** This is the concern flagged in the task.
  It is **verified false** by reading `streamFactory`: the subprocess runs
  once inside `streamFactory`, returns one text response, and the Pi
  agent core consumes that response without re-invoking anything. The
  Pi tools are advertised but never called (no `toolUse` stop reason).
  There is no double execution. Do not stop on this condition unless the
  drift check shows `streamFactory` changed.
- **`onAgentMessages` callers cannot handle a Factory transcript.** The
  workspace pane (`pane.tsx` `sendMessage`) and transcript persistence
  (`appendLocalAgentTranscript`) consume `AiAgentHistoryMessage[]`. A
  Factory turn produces `[user, assistant(text)]` — a shape they already
  handle for any non-tool structured turn. If a caller assumes
  `agentMessages` is only populated for non-Factory providers and breaks
  on a Factory transcript, stop and report. (Expected: no such
  assumption exists; `completedAgentMessages` is provider-agnostic.)

## Maintenance notes

- The Pi-layer tools advertised to the Factory provider are **not
  reachable today**. They exist for interface parity with the `structured`
  branch and so that a future plan bridging droid exec's internal tool
  calls to Pi `toolUse` stop reasons can light them up without re-touching
  `host.ts`. Do not remove them on the grounds that "they are never
  called" — that is the intended state until the subprocess bridge is
  built.
- The visibility win (`onAgentMessages`) is the concrete behavior change.
  If a future plan renders tool-call cards (plan 061) or replays
  transcripts, Factory turns now participate. Before this change they did
  not.
- If `streamFactory` is ever changed to surface real tool-use (returning
  `toolUse` stop reasons and expecting tool results to be fed back), the
  Pi tools here would start executing. At that point, audit for
  double-execution with the droid exec subprocess and decide whether the
  Pi tools or the subprocess tools own each capability. That decision is
  out of scope for this plan.
- `factoryConversationMessages` is still the right `messages` source for
  the Factory branch. Do not switch to passing raw `agentMessages` to
  `runAgent` — `extractPrompt` in `factory/provider.ts` is text-only and
  would drop `toolCall`/`toolResult` blocks. The flattened text history is
  the full conversation context for the droid exec prompt.
