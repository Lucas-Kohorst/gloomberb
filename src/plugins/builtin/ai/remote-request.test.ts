import { describe, expect, test } from "bun:test";
import type { RemoteControlRequest } from "../../../remote/types";
import type { AiAgentHistoryMessage } from "./agent-history";
import { applyRemoteControlText, parseRemoteControlRequest } from "./remote-request";

describe("parseRemoteControlRequest", () => {
  test("accepts fenced JSON and nested request wrappers", () => {
    expect(parseRemoteControlRequest(
      '```json\n{"type":"get","resource":"app://connections"}\n```',
    )).toEqual({ type: "get", resource: "app://connections" });
    expect(parseRemoteControlRequest(JSON.stringify({
      request: { type: "call", operation: "layout.undo" },
    }))).toEqual({ type: "call", operation: "layout.undo" });
  });

  test("ignores prose that is not a remote request", () => {
    expect(parseRemoteControlRequest("Opened the pane.")).toBeNull();
    expect(parseRemoteControlRequest('{"message":"done"}')).toBeNull();
  });

  test("normalizes batch.request arrays and rejects incomplete batches", () => {
    expect(parseRemoteControlRequest(JSON.stringify({
      type: "batch",
      request: [
        { type: "call", operation: "layout.new", input: { name: "Democrats" } },
        { type: "call", operation: "pane.show", input: { paneId: "sec" } },
      ],
    }))).toEqual({
      type: "batch",
      requests: [
        { type: "call", operation: "layout.new", input: { name: "Democrats" } },
        { type: "call", operation: "pane.show", input: { paneId: "sec" } },
      ],
    });
    expect(parseRemoteControlRequest('{"type":"batch"}')).toBeNull();
    expect(parseRemoteControlRequest('{"type":"call"}')).toBeNull();
  });
});

describe("applyRemoteControlText", () => {
  test("sends a parsed request and records a remote receipt", async () => {
    const requests: RemoteControlRequest[] = [];
    const history: AiAgentHistoryMessage[] = [];
    const result = await applyRemoteControlText(
      '{"type":"call","operation":"pane.show","input":{"paneId":"sec"}}',
      async (request) => {
        requests.push(request);
        return { ok: true, data: { opened: true } };
      },
      (messages) => history.push(...messages),
    );
    expect(result.applied).toBe(true);
    expect(result.output).toBe("opened sec");
    expect(requests).toEqual([{
      type: "call",
      operation: "pane.show",
      input: { paneId: "sec" },
    }]);
    expect(history).toEqual([
      expect.objectContaining({
        role: "assistant",
        content: [expect.objectContaining({ type: "toolCall", name: "gloomberb_remote" })],
      }),
      expect.objectContaining({
        role: "toolResult",
        toolName: "gloomberb_remote",
        isError: false,
      }),
    ]);
  });

  test("leaves ordinary prose alone", async () => {
    const result = await applyRemoteControlText("wrote plugin", async () => {
      throw new Error("should not send");
    });
    expect(result).toEqual({ applied: false, output: "wrote plugin" });
  });

  test("refuses capability.invoke before sending", async () => {
    await expect(applyRemoteControlText(
      JSON.stringify({ type: "call", operation: "capability.invoke", input: {} }),
      async () => ({ ok: true, data: {} }),
    )).rejects.toThrow(/capability\.invoke/);
  });

  test("does not crash on a batch without requests", async () => {
    const result = await applyRemoteControlText(
      '{"type":"batch"}',
      async () => {
        throw new Error("should not send");
      },
    );
    expect(result).toEqual({ applied: false, output: '{"type":"batch"}' });
  });

  test("sends a batch.request array as requests", async () => {
    const requests: RemoteControlRequest[] = [];
    const result = await applyRemoteControlText(
      JSON.stringify({
        type: "batch",
        request: [
          { type: "call", operation: "layout.new", input: { name: "Democrats" } },
          { type: "call", operation: "pane.show", input: { paneId: "sec" } },
        ],
      }),
      async (request) => {
        requests.push(request);
        return { ok: true, data: { ok: true } };
      },
    );
    expect(result.applied).toBe(true);
    expect(result.output).toBe("created layout “Democrats” · opened sec");
    expect(requests).toEqual([{
      type: "batch",
      requests: [
        { type: "call", operation: "layout.new", input: { name: "Democrats" } },
        { type: "call", operation: "pane.show", input: { paneId: "sec" } },
      ],
    }]);
  });

  test("does not dump inventory JSON as the visible reply", async () => {
    const result = await applyRemoteControlText(
      '{"type":"get","resource":"app://commands"}',
      async () => ({
        ok: true,
        data: [{ id: "open-brokers", label: "Open Brokers" }],
      }),
    );
    expect(result).toEqual({
      applied: true,
      output: "Read app://commands.",
    });
    expect(result.output).not.toContain("open-brokers");
  });
});
