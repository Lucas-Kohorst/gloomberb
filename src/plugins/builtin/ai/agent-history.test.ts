import { describe, expect, test } from "bun:test";
import {
  extractActionReceipts,
  extractToolCards,
  type AiAgentHistoryMessage,
} from "./agent-history";

function assistantToolCall(id: string, name: string, args: Record<string, unknown> = {}): AiAgentHistoryMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id, name, arguments: args }],
  };
}

function toolResult(id: string, text: string, isError = false): AiAgentHistoryMessage {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: "tool",
    content: [{ type: "text", text }],
    isError,
  };
}

describe("extractToolCards", () => {
  test("pairs a toolCall with its toolResult by id and marks success", () => {
    const cards = extractToolCards([
      { role: "user", content: "open the watchlist" },
      assistantToolCall("call-1", "gloomberb_remote", { operation: "pane.open" }),
      toolResult("call-1", '{"ok":true}'),
      { role: "assistant", content: [{ type: "text", text: "Opened it." }] },
    ]);

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      id: "call-1",
      toolName: "gloomberb_remote",
      status: "success",
      isError: false,
      result: '{"ok":true}',
      arguments: { operation: "pane.open" },
    });
  });

  test("marks error status from isError toolResult", () => {
    const cards = extractToolCards([
      assistantToolCall("call-err", "gloomberb_cli", { cmd: "bad" }),
      toolResult("call-err", "command not found", true),
    ]);

    expect(cards[0]?.status).toBe("error");
    expect(cards[0]?.isError).toBe(true);
    expect(cards[0]?.result).toBe("command not found");
  });

  test("leaves a card running when no result follows (cancelled mid-flight)", () => {
    const cards = extractToolCards([
      assistantToolCall("call-running", "gloomberb_show", { pane: "watchlist" }),
    ]);

    expect(cards).toHaveLength(1);
    expect(cards[0]?.status).toBe("running");
    expect(cards[0]?.isError).toBe(false);
    expect(cards[0]?.result).toBeUndefined();
  });

  test("handles multiple tool calls in one assistant turn", () => {
    const cards = extractToolCards([
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "a", name: "tool_a", arguments: {} },
          { type: "toolCall", id: "b", name: "tool_b", arguments: { x: 1 } },
        ],
      },
      toolResult("a", "a-result"),
      toolResult("b", "b-result"),
    ]);

    expect(cards.map((c) => c.id)).toEqual(["a", "b"]);
    expect(cards[0]?.result).toBe("a-result");
    expect(cards[1]?.result).toBe("b-result");
  });

  test("drops a tool result whose id matches no call (defensive)", () => {
    const cards = extractToolCards([
      assistantToolCall("call-1", "tool"),
      toolResult("orphan-result", "no matching call"),
    ]);

    expect(cards).toHaveLength(1);
    expect(cards[0]?.id).toBe("call-1");
    expect(cards[0]?.status).toBe("running");
  });

  test("joins multi-line tool result content", () => {
    const cards = extractToolCards([
      assistantToolCall("call-1", "tool"),
      {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "tool",
        content: [
          { type: "text", text: "line one" },
          { type: "text", text: "line two" },
        ],
        isError: false,
      },
    ]);

    expect(cards[0]?.result).toBe("line one\nline two");
  });
});

describe("extractActionReceipts", () => {
  test("labels successful pane and layout mutations and marks them undoable", () => {
    const receipts = extractActionReceipts([
      assistantToolCall("show-1", "gloomberb_show", { paneId: "sec" }),
      toolResult("show-1", '{"ok":true}'),
      assistantToolCall("remote-1", "gloomberb_remote", {
        request: { type: "call", operation: "layout.new", input: { name: "Democrats" } },
      }),
      toolResult("remote-1", '{"ok":true}'),
    ]);
    expect(receipts).toEqual([
      {
        id: "show-1",
        toolCallId: "show-1",
        toolName: "gloomberb_show",
        operation: "pane.show",
        label: "opened sec",
        undoable: true,
      },
      {
        id: "remote-1",
        toolCallId: "remote-1",
        toolName: "gloomberb_remote",
        operation: "layout.new",
        label: "created layout “Democrats”",
        undoable: true,
      },
    ]);
  });

  test("skips failed, running, and non-app tools", () => {
    expect(extractActionReceipts([
      assistantToolCall("cli-1", "gloomberb_cli", { args: ["quote", "AAPL"] }),
      toolResult("cli-1", '{"ok":true}'),
      assistantToolCall("show-err", "gloomberb_show", { paneId: "sec" }),
      toolResult("show-err", "missing", true),
      assistantToolCall("show-run", "gloomberb_show", { paneId: "sec" }),
    ])).toEqual([]);
  });
});
