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
});
