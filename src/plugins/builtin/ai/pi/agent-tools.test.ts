import { describe, expect, test } from "bun:test";
import { buildAgentShowRequest, refuseUnsafeRemoteRequest, resolveAgentCliCommand } from "./agent-tools";

describe("agent remote and CLI guards", () => {
  test("allows pane, layout, and command-bar remote calls", () => {
    expect(() => refuseUnsafeRemoteRequest({
      type: "call",
      operation: "app.openCommandBar",
      input: { query: "developer" },
    })).not.toThrow();
    expect(() => refuseUnsafeRemoteRequest({
      type: "call",
      operation: "pane.show",
      input: { paneId: "sec" },
    })).not.toThrow();
    expect(() => refuseUnsafeRemoteRequest({
      type: "batch",
      requests: [
        { type: "get", resource: "app://snapshot" },
        { type: "call", operation: "layout.new", input: { name: "Democrats" } },
      ],
    })).not.toThrow();
    expect(() => refuseUnsafeRemoteRequest({ type: "get", resource: "app://snapshot" })).not.toThrow();
    expect(() => refuseUnsafeRemoteRequest({ type: "schema" })).not.toThrow();
  });

  test("refuses capability.invoke, including inside batches", () => {
    expect(() => refuseUnsafeRemoteRequest({
      type: "call",
      operation: "capability.invoke",
      input: { capabilityId: "news", operationId: "search" },
    })).toThrow(/capability\.invoke/);
    expect(() => refuseUnsafeRemoteRequest({
      type: "batch",
      requests: [
        { type: "get", resource: "app://connections" },
        { type: "call", operation: "capability.invoke", input: {} },
      ],
    })).toThrow(/capability\.invoke/);
  });

  test("refuses patch app://config, including inside batches", () => {
    expect(() => refuseUnsafeRemoteRequest({
      type: "patch",
      resource: "app://config",
      patch: [],
    })).toThrow(/app:\/\/config cannot be patched by the agent/);
    expect(() => refuseUnsafeRemoteRequest({
      type: "batch",
      requests: [
        { type: "get", resource: "app://snapshot" },
        { type: "patch", resource: "app://config", patch: [{ op: "replace", path: "/activeLayoutIndex", value: 0 }] },
      ],
    })).toThrow(/app:\/\/config cannot be patched by the agent/);
  });

  test("seeds chart-composer-pane from gloomberb_show arg", () => {
    expect(buildAgentShowRequest({
      templateId: "chart-composer-pane",
      arg: "POLY:fed-cut-september, FRED:FEDFUNDS",
    })).toEqual({
      type: "call",
      operation: "pane.createFromTemplate",
      input: {
        templateId: "chart-composer-pane",
        options: { arg: "POLY:fed-cut-september, FRED:FEDFUNDS" },
      },
    });
    expect(() => buildAgentShowRequest({
      paneId: "chart-composer",
      arg: "FRED:FEDFUNDS",
    })).toThrow(/arg with templateId/);
  });

  test("allows background CLI commands and rejects UI launch", () => {
    expect(resolveAgentCliCommand(["new", "hello-world"])).toBe("new");
    expect(resolveAgentCliCommand(["--json", "validate", "hello-world"])).toBe("validate");
    expect(resolveAgentCliCommand(["plugins"])).toBe("plugins");
    expect(() => resolveAgentCliCommand(["launch-ui"])).toThrow(/cannot launch a separate UI process/);
    expect(() => resolveAgentCliCommand(["ui"])).toThrow(/cannot launch a separate UI process/);
    expect(() => resolveAgentCliCommand(["not-a-command"])).toThrow(/not allowed/);
  });

  test("validates the dispatched command, not a flag value", () => {
    // --data-dir consumes the next argument, so the real command is "ai",
    // which is not in the agent allowlist. The pre-parse allowlist lookup
    // would have seen the allowed word "quote" instead.
    expect(() => resolveAgentCliCommand([
      "--data-dir", "quote",
      "--data-dir=/tmp/gloomberb",
      "ai", "ask", "--provider", "factory", "hello",
    ])).toThrow(/"ai" is not allowed/);
    expect(resolveAgentCliCommand(["--data-dir", "/tmp/gloomberb", "quote", "AAPL"])).toBe("quote");
    expect(resolveAgentCliCommand(["quote", "--limit", "3", "AAPL"])).toBe("quote");
    expect(() => resolveAgentCliCommand(["--limit", "3"])).toThrow(/must include a command/);
  });

  test("plugin lifecycle commands are not agent-callable", () => {
    expect(() => resolveAgentCliCommand(["install", "evil/repo"])).toThrow(/not allowed/);
    expect(() => resolveAgentCliCommand(["update", "evil/repo"])).toThrow(/not allowed/);
    expect(() => resolveAgentCliCommand(["remove", "evil/repo"])).toThrow(/not allowed/);
  });
});
