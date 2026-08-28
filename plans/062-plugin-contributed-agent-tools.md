# 062 — Plugin-contributed agent tools

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat c01396c5..HEAD -- src/plugins/builtin/ai/runner.ts src/plugins/builtin/ai/pi/host.ts src/plugins/registry/context.ts src/types/plugin.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (plan 064 will extend the prompt side; this plan only
  passes `AgentTool.description` through, which Pi already does)
- **Category**: agents / platform
- **Planned at**: commit `c01396c5`, 2026-08-26

## Why this matters

Agent tools are hardcoded per output mode in
`src/plugins/builtin/ai/pi/host.ts`. The structured mode gets
`createRemoteTool`, `createAgentCliTool`, `createAgentShowTool`, and
`createAgentPluginFileTools()`. The screener mode gets
`createScreenerMarketDataTool`, `createScreenerSubmissionTool`, and
`createAgentPluginFileTools()`. There is no way for a plugin to register an
additional agent tool — every plugin capability the agent should be able to
invoke has to be wired into `host.ts` by hand.

The `AiRunHost` interface in `src/plugins/builtin/ai/runner.ts` already has
`registerProvider()` for custom AI providers (implemented in `host.ts` as
`runtime.registerCustomProvider(provider)`). An analogous `registerTool()`
on the host, plus a `ctx.registerAgentTool()` on the plugin setup context,
lets plugins expose their own capabilities to the agent from `setup()` without
touching `host.ts`.

This is the small, mechanical half of the agent-extensibility story. Plan 064
will add a system-prompt fragment mechanism so plugins can describe their
tools in prose; this plan only needs the tool's existing `description` field
to reach the model, which Pi's `runAgent` already does from the `tools[]`
array.

## Current state

### `AiRunHost` interface — `src/plugins/builtin/ai/runner.ts:105`

```typescript
export interface AiRunHost {
  run(options: { ... }): AiRunController;
  checkStatus?(providerId: AiProviderId): Promise<AiProviderStatusResult>;
  getCatalog?(): Promise<AiRuntimeCatalog>;
  hasProvider?(providerId: AiProviderId): boolean;
  connect?(...): Promise<AiRuntimeCatalog>;
  disconnect?(providerId: AiProviderId): Promise<AiRuntimeCatalog>;
  /**
   * Register a custom Pi provider at runtime. Plugins can use this to add
   * dynamically-discovered providers without reinitialising the runtime.
   */
  registerProvider?(provider: unknown): void;
  /** Tool definitions available to the agent for tool-use. */
  tools?: { name: string; description: string; parameters: Record<string, ...> }[];
  /** Return the available tool definitions for the agent. */
  getAvailableTools?(): { name: string; description: string; parameters: Record<string, ...> }[];
}
```

`registerProvider` is the convention to mirror.

### `createPiAiHost` — `src/plugins/builtin/ai/pi/host.ts:442`

The host is a single returned object literal. `registerProvider` is
implemented inline:

```typescript
registerProvider(provider: Provider) {
  runtime.registerCustomProvider(provider);
},
```

`run()` builds the tool arrays inline per output mode
(`src/plugins/builtin/ai/pi/host.ts:533` screener, `:559` structured):

```typescript
// screener
tools: [
  createScreenerMarketDataTool({ appKind, dataDir, sendRequest: sendRemoteRequest }),
  createScreenerSubmissionTool((payload) => { submitted = payload; }),
  ...createAgentPluginFileTools(),
],

// structured
tools: [
  createRemoteTool({ appKind, dataDir, sendRequest: sendRemoteRequest }),
  createAgentCliTool(),
  createAgentShowTool(sendRemoteRequest, { appKind, dataDir }),
  ...createAgentPluginFileTools(),
],
```

`getAvailableTools()` (host.ts:625) rebuilds the structured tool list for the
inventory surface.

### `AgentTool` type — `@earendil-works/pi-agent-core`

Imported already in `host.ts:2` and `agent-tools.ts:2`:

```typescript
export interface AgentTool<TSchema extends TObject = TObject, TDetails = unknown> {
  name: string;
  label?: string;
  description?: string;
  parameters: TSchema;
  executionMode?: "sequential" | "parallel";
  execute(toolCallId: string, params: Static<TSchema>, signal?: AbortSignal): Promise<AgentToolResult<TDetails>>;
}
```

`runtime.runAgent({ tools }: { tools?: AgentTool[] })` accepts the typed
array directly (`src/plugins/builtin/ai/pi/runtime.ts:178`), so a
plugin-contributed `AgentTool` is structurally identical to the built-in
ones. No adapter is needed.

### Plugin setup context — `src/plugins/registry/context.ts`

`GloomPluginContext` is declared in `src/types/plugin.ts:524` and constructed
by `createRegistryPluginContext()` in `src/plugins/registry/context.ts:124`.
Each `registerX` method forwards to `contributions` or a passed-in callback.
There is **no** `registerAiProvider` on the context today — the comment in
`src/plugins/builtin/ai/providers.ts:227` ("added by plugins via
`ctx.registerAiProvider()`") is aspirational; only the host-side
`registerProvider` exists. This plan therefore adds the **first**
plugin-facing AI registration method, and names it `registerAgentTool` per
the task. (A follow-up can add `ctx.registerAiProvider` the same way; do not
add it here — out of scope.)

### Timing

`createPiAiHost` + `installAiRunHost` run in `start.tsx:109` **before** the
registry sets plugins up (plugins load via `loadExternalPlugins` earlier,
but `setup()` runs when the registry mounts, after the host is installed).
So by the time a plugin's `setup()` calls `ctx.registerAgentTool(tool)`, the
configured host exists. `ctx.registerAgentTool` must therefore forward to
the currently-configured host via the runner module's accessor, not capture a
host reference at context-construction time (the host can be reinstalled in
tests via `setAiRunHost`). Use the same accessor the runner exposes for
reads; see Step 4 for the exact function.

## Commands you will need

| Purpose   | Command                                                | Expected on success |
|-----------|--------------------------------------------------------|---------------------|
| Typecheck | `npx tsc --noEmit`                                     | exit 0, no errors   |
| Host test | `bun test src/plugins/builtin/ai/pi/host.test.ts`      | all pass           |
| Runner test | `bun test src/plugins/builtin/ai/runner.test.ts`    | all pass           |
| Full AI suite | `bun test src/plugins/builtin/ai/`                 | all pass           |

## Scope

**In scope**:
- `src/plugins/builtin/ai/runner.ts` — add `registerTool?` to `AiRunHost`;
  add a `getAiRunHost()` accessor (module-private) so the plugin context can
  forward registrations to the live host.
- `src/plugins/builtin/ai/pi/host.ts` — implement `registerTool` in
  `createPiAiHost`; include registered tools in the screener and structured
  tool arrays and in `getAvailableTools()`.
- `src/plugins/registry/context.ts` — add `registerAgentTool` to
  `RegistryPluginContextOptions` and the returned context object; forward to
  the live host.
- `src/types/plugin.ts` — add `registerAgentTool` to `GloomPluginContext`.
- `src/cli/pane-functions/discovery.ts` — add a no-op `registerAgentTool` to
  the exhaustively-typed discovery context (it asserts exhaustiveness; a new
  method on `GloomPluginContext` will break its type check otherwise).
- `src/plugins/builtin/ai/pi/host.test.ts` — new test: register a custom
  tool, verify it appears in the agent's tool array for both structured and
  screener modes.

**Out of scope**:
- `src/plugins/builtin/ai/pi/agent-tools.ts` — do not change existing tools.
- `src/plugins/builtin/ai/tools.ts` — do not change plugin tools.
- Individual plugins using the new API — follow-up work.
- System-prompt fragments / per-tool prose customization — plan 064.
- `ctx.registerAiProvider` — out of scope (only `registerAgentTool` here).
- The hosted/browser AI host (`src/plugins/builtin/ai/browser.ts`) — leave
  its `AiRunHost` impl alone; `registerTool` is optional on the interface,
  so a host that does not implement it simply ignores plugin tools. Do not
  add it there unless a STOP condition forces it.

## Steps

### Step 1: Add `registerTool` to the `AiRunHost` interface

In `src/plugins/builtin/ai/runner.ts`, add to `AiRunHost` next to
`registerProvider`:

```typescript
/**
 * Register a plugin-contributed agent tool at runtime. Plugins call this
 * via `ctx.registerAgentTool()` from `setup()`. Registered tools are
 * appended to the built-in tool arrays for both structured and screener
 * output modes. The host must accept the tool before the run starts; tools
 * registered mid-run are not picked up by an in-flight agent loop.
 */
registerTool?(tool: AgentTool): void;
```

Import the `AgentTool` type at the top of `runner.ts`:

```typescript
import type { AgentTool } from "@earendil-works/pi-agent-core";
```

Also add a module-private accessor so the plugin context (which lives in a
different package boundary) can forward to the currently-configured host
without capturing a stale reference:

```typescript
/** @internal — used by the plugin context to forward tool registrations. */
export function getAiRunHost(): AiRunHost | null {
  return configuredHost;
}
```

`configuredHost` already exists at `runner.ts:148` and is mutated by
`setAiRunHost` (`:181`), so this accessor reflects reinstallations in tests.

**Verify**: `npx tsc --noEmit` → exit 0 (the new optional method and accessor
typecheck; no call sites changed yet).

### Step 2: Implement `registerTool` in `createPiAiHost`

In `src/plugins/builtin/ai/pi/host.ts`, inside `createPiAiHost` (the
returned object literal, around `:442`), add a module-private store above
the `return {` and implement the method:

```typescript
const registeredTools: AgentTool[] = [];
```

Then in the returned host object, next to `registerProvider` (`:520`):

```typescript
registerTool(tool: AgentTool) {
  if (registeredTools.some((existing) => existing.name === tool.name)) return;
  registeredTools.push(tool);
},
```

Dedup by `tool.name` — the built-in tools (`gloomberb_remote`,
`gloomberb_cli`, `gloomberb_show`, `gloomberb_market_data`,
`submit_screener_results`, and the plugin-file tools) occupy fixed names; a
plugin that collides is silently ignored on re-registration. (A duplicate
name would otherwise make Pi reject the run; dedup is the safe default.)

Include registered tools in the screener tool array (`:533`):

```typescript
tools: [
  createScreenerMarketDataTool({ appKind: options.appKind, dataDir: options.dataDir, sendRequest: sendRemoteRequest }),
  createScreenerSubmissionTool((payload) => { submitted = payload; }),
  ...createAgentPluginFileTools(),
  ...registeredTools,
],
```

Include them in the structured tool array (`:559`):

```typescript
tools: [
  createRemoteTool({ appKind: options.appKind, dataDir: options.dataDir, sendRequest: sendRemoteRequest }),
  createAgentCliTool(),
  createAgentShowTool(sendRemoteRequest, { appKind: options.appKind, dataDir: options.dataDir }),
  ...createAgentPluginFileTools(),
  ...registeredTools,
],
```

Append registered tools **last** so built-in tools keep their existing
positions and the existing tests that assert tool ordering / presence keep
passing.

Include them in `getAvailableTools()` (`:625`) so the inventory surface
lists plugin tools too. That function rebuilds the structured list and maps
to a `{ name, description, parameters }` shape; append the same
`...registeredTools` before the `.map(...)`:

```typescript
const tools = [
  createRemoteTool({ ... }),
  createAgentCliTool(),
  createAgentShowTool(sendRemoteRequest, { ... }),
  ...createAgentPluginFileTools(),
  ...registeredTools,
];
return tools.map((tool) => ({ ... }));
```

Note: `getAvailableTools()` only covers the structured-mode set today. Do
not invent a screener equivalent here — out of scope. The screener's
`submit_screener_results` tool is intentionally terminal and must not be
exposed via the inventory; leaving `getAvailableTools` structured-only
preserves that.

**Verify**: `npx tsc --noEmit` → exit 0. `bun test src/plugins/builtin/ai/pi/host.test.ts` → all pass (no behavior change yet for the existing tests because `registeredTools` starts empty).

### Step 3: Add `registerAgentTool` to the plugin context type

In `src/types/plugin.ts`, add to `GloomPluginContext` (near the other
`registerX` methods, e.g. after `registerContextMenuProvider`):

```typescript
  /**
   * Register an agent tool the AI assistant can call. The tool is appended
   * to the built-in agent tools for structured and screener output modes.
   * Use a unique `name`; collisions with built-in tools are ignored.
   * Registered after the built-ins, so built-in tool ordering is stable.
   */
  registerAgentTool(tool: import("@earendil-works/pi-agent-core").AgentTool): void;
```

Use an inline `import(...)` type to avoid adding a top-level import to
`plugin.ts` (the file already uses this pattern for `NewsQuery` etc., see
`watchNewsQuery?` at `:545`). `@earendil-works/pi-agent-core` is already a
dependency (used by `host.ts` and `agent-tools.ts`), so the type resolves.

**Verify**: `npx tsc --noEmit` → will fail on `src/cli/pane-functions/discovery.ts` (exhaustive context). Fix in Step 4.

### Step 4: Wire `registerAgentTool` through the registry context

In `src/plugins/registry/context.ts`:

1. Add to `RegistryPluginContextOptions`:

   ```typescript
   registerAgentTool: (tool: import("@earendil-works/pi-agent-core").AgentTool) => void;
   ```

   The registry does not own the host; the caller (registry construction site)
   provides a forwarder. This mirrors how `registerCapabilityForPlugin`,
   `watchNewsQuery`, etc. are passed in.

2. Destructure `registerAgentTool` in `createRegistryPluginContext`'s
   parameter list and pass it straight through in the returned object:

   ```typescript
   registerAgentTool,
   ```

In `src/cli/pane-functions/discovery.ts`, add a no-op to the exhaustively-
typed `discoveryContext` so its type assertion against `GloomPluginContext`
still compiles:

```typescript
registerAgentTool: () => {},
```

Now find where `createRegistryPluginContext` is called (the registry's
`setupPlugin`/`registerPlugin` path — grep for `createRegistryPluginContext`
to find the call site) and supply a forwarder that calls the live host:

```typescript
registerAgentTool: (tool) => {
  const host = getAiRunHost();
  host?.registerTool?.(tool);
},
```

Import `getAiRunHost` from `../../builtin/ai/runner` at that call site. Use
the accessor (not a captured host reference) so test reinstalls via
`setAiRunHost` are reflected. If the host is `null` or does not implement
`registerTool` (e.g. the browser host), the call is a no-op — that is the
intended graceful degradation.

**Verify**: `npx tsc --noEmit` → exit 0. `bun test src/plugins/builtin/ai/runner.test.ts` → all pass.

### Step 5: Test that a registered tool reaches the agent

In `src/plugins/builtin/ai/pi/host.test.ts`, add a new `describe` block
("Pi AI host plugin-contributed tools") with two tests, mirroring the
existing `createHostFixture` helper and the
`exposes market data, submission, and file tools to the screener` /
`keeps structured agent work headless` tests that inspect `context.tools`.

Structured-mode test:

```typescript
test("includes a plugin-registered tool in the structured tool array", async () => {
  const fixture = createHostFixture(async () => ({ ok: true, data: {} }));
  const customTool: AgentTool = {
    name: "plugin_echo",
    description: "Echo a string back to the agent.",
    parameters: Type.Object({ message: Type.String() }),
    async execute(_id, params) {
      return { content: [{ type: "text", text: params.message }] };
    },
  };
  fixture.host.registerTool?.(customTool);

  fixture.faux.setResponses([
    (context) => {
      const names = context.tools?.map((tool) => tool.name) ?? [];
      expect(names).toContain("gloomberb_remote");
      expect(names).toContain("gloomberb_cli");
      expect(names).toContain("plugin_echo");
      expect(names.at(-1)).toBe("plugin_echo"); // appended last
      return fauxAssistantMessage(fauxToolCall("plugin_echo", { message: "hi" }), { stopReason: "toolUse" });
    },
    fauxAssistantMessage("Done."),
  ]);

  const output = await fixture.host.run({
    providerId: "anthropic",
    prompt: "echo hi",
    outputMode: "structured",
  }).done;

  expect(output).toBe("Done.");
});
```

Screener-mode test:

```typescript
test("includes a plugin-registered tool in the screener tool array", async () => {
  const fixture = createHostFixture();
  const customTool: AgentTool = {
    name: "plugin_risk_score",
    description: "Return a risk score for a symbol.",
    parameters: Type.Object({ symbol: Type.String() }),
    async execute(_id, params) {
      return { content: [{ type: "text", text: `risk:${params.symbol}=42` }] };
    },
  };
  fixture.host.registerTool?.(customTool);

  fixture.faux.setResponses([
    (context) => {
      const names = context.tools?.map((tool) => tool.name) ?? [];
      expect(names).toContain("gloomberb_market_data");
      expect(names).toContain("submit_screener_results");
      expect(names).toContain("plugin_risk_score");
      expect(names.at(-1)).toBe("plugin_risk_score");
      return fauxAssistantMessage(fauxToolCall("plugin_risk_score", { symbol: "NVDA" }), { stopReason: "toolUse" });
    },
    fauxAssistantMessage(fauxToolCall("submit_screener_results", {
      title: "NVDA",
      tickers: [{ symbol: "NVDA", exchange: "NASDAQ", reason: "Risk score checked." }],
    }), { stopReason: "toolUse" }),
  ]);

  await fixture.host.run({
    providerId: "anthropic",
    prompt: "Screen NVDA",
    outputMode: "screener",
  }).done;
});
```

Add a dedup test:

```typescript
test("ignores a second registration of the same tool name", async () => {
  const fixture = createHostFixture();
  const tool: AgentTool = {
    name: "plugin_once",
    description: "Once.",
    parameters: Type.Object({}),
    async execute() { return { content: [{ type: "text", text: "x" }] }; },
  };
  fixture.host.registerTool?.(tool);
  fixture.host.registerTool?.({ ...tool, description: "Different description." });

  fixture.faux.setResponses([
    (context) => {
      const matches = context.tools?.filter((t) => t.name === "plugin_once") ?? [];
      expect(matches).toHaveLength(1);
      expect(matches[0]?.description).toBe("Once.");
      return fauxAssistantMessage(fauxToolCall("submit_screener_results", {
        title: "ok", tickers: [],
      }), { stopReason: "toolUse" });
    },
  ]);

  await fixture.host.run({
    providerId: "anthropic",
    prompt: "go",
    outputMode: "screener",
  }).done;
});
```

Add the needed imports at the top of the test file:

```typescript
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
```

(`Type` is already used elsewhere in the suite? Check — if not, add it. The
host test file currently imports from `@earendil-works/pi-ai` and the local
modules only; add both imports.)

**Verify**: `bun test src/plugins/builtin/ai/pi/host.test.ts` → all pass,
including the three new tests.

### Step 6: Full verification

**Verify**:
- `npx tsc --noEmit` → exit 0
- `bun test src/plugins/builtin/ai/pi/host.test.ts` → all pass
- `bun test src/plugins/builtin/ai/runner.test.ts` → all pass
- `bun test src/plugins/builtin/ai/` → all pass

## Done criteria

- [ ] `npx tsc --noEmit` exits 0
- [ ] `bun test src/plugins/builtin/ai/pi/host.test.ts` passes (incl. 3 new tests)
- [ ] `bun test src/plugins/builtin/ai/runner.test.ts` passes
- [ ] `bun test src/plugins/builtin/ai/` passes
- [ ] `AiRunHost.registerTool?` exists and is implemented in `createPiAiHost`
- [ ] Registered tools appear in both the structured and screener tool arrays
- [ ] `GloomPluginContext.registerAgentTool` exists and forwards to the live host via `getAiRunHost()`
- [ ] `src/cli/pane-functions/discovery.ts` still typechecks (no-op added)
- [ ] No files outside the in-scope list are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

- **`AgentTool` from `pi-agent-core` has constraints that make plugin-
  contributed tools unsafe.** The type is a plain interface with a
  `parameters: TObject` (typebox schema) and an async `execute`; Pi's
  `runAgent` accepts `AgentTool[]` directly (`runtime.ts:178`). If importing
  `AgentTool` into `runner.ts` or `plugin.ts` pulls a type that does not
  resolve under `tsc --noEmit`, stop and report the resolution error — do not
  loosen the type or introduce a structural re-definition.
- **The plugin context type system does not support adding new methods
  easily.** `GloomPluginContext` is a flat interface and `createRegistryPluginContext`
  returns an object literal; adding a method is mechanical. If the exhaustive
  discovery context in `src/cli/pane-functions/discovery.ts` uses a
  `satisfies GloomPluginContext` that cannot accept a no-op, or if adding the
  method breaks other exhaustive mock contexts (grep for
  `as GloomPluginContext` and `satisfies GloomPluginContext`), stop and list
  every site that needs a no-op so the executor can decide whether the
  blast radius is acceptable.
- **`getAiRunHost()` cannot be exported from `runner.ts` without a circular
  import.** The plugin context lives in `src/plugins/registry/context.ts`;
  `runner.ts` lives in `src/plugins/builtin/ai/`. Check
  `src/plugins/registry/context.ts`'s existing imports — if it already
  imports from `../builtin/...` (it does not today), a cycle is possible. If
  `tsc` reports a cycle, instead expose a registration callback on the
  registry (e.g. `registerAgentToolForwarder`) that the AI module wires to
  `getAiRunHost().registerTool` at install time, and stop to report the
  chosen shape.
- **A built-in tool name collides with a plugin tool name and Pi rejects the
  run.** The dedup in Step 2 only dedups among *registered* tools; it does
  not dedup against built-ins. If a plugin registers `gloomberb_remote`, Pi
  will receive two tools with the same name. If a test or review shows this
  is a real risk, extend the dedup to skip any registered tool whose name
  matches a built-in (compare against the built-in tool array before
  appending) and add a test for it. Do not silently allow the collision.

## Maintenance notes

- Any plugin that wants the agent to call its capability should expose it as
  an `AgentTool` from `setup()` via `ctx.registerAgentTool(tool)`. Use a
  unique `name` prefixed with the plugin id (e.g. `treasury_auctions_search`)
  to avoid collisions with future built-ins.
- Registered tools are appended after built-ins; built-in tool ordering is
  stable and existing tests that assert order keep passing.
- The browser/hosted AI host (`browser.ts`) does not implement
  `registerTool`; plugin tools are silently dropped there. If hosted should
  support plugin tools, implement `registerTool` in `createBrowserAiRunHost`
  in a follow-up — do not add it here.
- Plan 064 will add a system-prompt fragment mechanism so plugins can
  describe their tools in prose. Until then, the tool's `description` field
  (which Pi already sends to the model from `tools[]`) is the only prose the
  agent sees for a plugin tool — keep `description` clear and specific.
- `getAvailableTools()` only inventories structured-mode tools today. A
  screener inventory (if ever needed) must not expose
  `submit_screener_results`; leave `getAvailableTools` structured-only.
