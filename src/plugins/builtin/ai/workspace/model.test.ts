import { describe, expect, test } from "bun:test";
import {
  appendLocalAgentMessages,
  appendLocalAgentTranscript,
  buildLocalAgentHistory,
  buildLocalAgentRequestPrompt,
  buildLocalAgentTranscript,
  createLocalAgentThread,
  EMPTY_LOCAL_AGENT_WORKSPACE,
  normalizeLocalAgentWorkspace,
  updateLocalAgentThread,
} from "./model";

describe("local agent workspace model", () => {
  test("binds a provider at creation and refuses later provider mutation", () => {
    const created = createLocalAgentThread(EMPTY_LOCAL_AGENT_WORKSPACE, "anthropic", {
      id: "thread-1",
      now: 10,
      modelId: "sonnet",
    });
    const attemptedMutation = updateLocalAgentThread(created, "thread-1", (thread) => ({
      ...thread,
      providerId: "openai-codex",
      modelId: "gpt-custom",
    }));

    expect(attemptedMutation.threads[0]?.providerId).toBe("anthropic");
    expect(attemptedMutation.threads[0]?.modelId).toBe("sonnet");
  });

  test("creates a second provider thread without changing the first transcript", () => {
    const claude = createLocalAgentThread(EMPTY_LOCAL_AGENT_WORKSPACE, "anthropic", { id: "claude-1", now: 10 });
    const withMessage = appendLocalAgentMessages(claude, "claude-1", [{
      id: "message-1",
      role: "assistant",
      content: "Original answer",
      createdAt: 11,
      status: "complete",
    }]);
    const codex = createLocalAgentThread(withMessage, "openai-codex", { id: "codex-1", now: 12 });

    expect(codex.activeThreadId).toBe("codex-1");
    expect(codex.threads.find((thread) => thread.id === "claude-1")?.messages[0]?.content).toBe("Original answer");
  });

  test("preserves legacy Pi and OpenCode threads as history", () => {
    const normalized = normalizeLocalAgentWorkspace({
      activeThreadId: "open-code-1",
      threads: [
        {
          id: "open-code-1",
          providerId: "opencode",
          modelId: "openai/gpt-5.4",
          title: "OpenCode research",
          createdAt: 1,
          updatedAt: 2,
          messages: [{ id: "m1", role: "assistant", content: "Saved answer", createdAt: 2, status: "complete" }],
        },
        {
          id: "pi-1",
          providerId: "pi",
          title: "Pi research",
          createdAt: 1,
          updatedAt: 1,
          messages: [],
        },
      ],
    });

    expect(normalized.activeThreadId).toBe("open-code-1");
    expect(normalized.threads.map((thread) => thread.providerId)).toEqual(["opencode", "pi"]);
    expect(normalized.threads[0]?.messages[0]?.content).toBe("Saved answer");
  });

  test("normalizes and creates Gemini threads admitted by the shared runner flow", () => {
    const normalized = normalizeLocalAgentWorkspace({
      activeThreadId: "gemini-1",
      threads: [{
        id: "gemini-1",
        providerId: "gemini",
        modelId: "gemini-2.5-pro",
        title: "Gemini research",
        createdAt: 1,
        updatedAt: 1,
        messages: [],
      }],
    });
    const created = createLocalAgentThread(EMPTY_LOCAL_AGENT_WORKSPACE, "google", {
      id: "gemini-2",
      now: 2,
      providerLabel: "Google Gemini",
    });

    expect(normalized.threads[0]?.providerId).toBe("google");
    expect(normalized.threads[0]?.modelId).toBe("gemini-2.5-pro");
    expect(created.threads[0]?.title).toBe("New Google Gemini thread");
  });

  test("includes the live desk without a ticker dump unless the user attached one", () => {
    const withoutDump = buildLocalAgentRequestPrompt("Compare the risks", [], {
      layoutName: "Democrats",
      focusedPaneId: "sec:main",
      panes: [{
        instanceId: "sec:main",
        paneId: "sec",
        placement: "docked",
        focused: true,
        ticker: "AAPL",
      }],
    });
    const withDump = buildLocalAgentRequestPrompt("Compare the risks", [{
      id: "ticker:AAPL:10",
      kind: "ticker",
      label: "Ticker AAPL",
      preview: "Apple Inc. (AAPL)",
      content: "Company: Apple Inc. (AAPL)\nCurrent Price: $210.00",
    }], {
      layoutName: "Democrats",
      focusedPaneId: "sec:main",
      panes: [{
        instanceId: "sec:main",
        paneId: "sec",
        placement: "docked",
        focused: true,
        ticker: "AAPL",
      }],
    });

    expect(withoutDump).toContain("Live desk: Democrats");
    expect(withoutDump).toContain("sec:main");
    expect(withoutDump).toContain("AAPL");
    expect(withoutDump).not.toContain("$210.00");
    expect(withDump).toContain("Extra ticker dump attached by the user");
    expect(withDump).toContain("Company: Apple Inc. (AAPL)");
  });

  test("clips oversized ticker attachments before they enter the prompt", () => {
    const prompt = buildLocalAgentRequestPrompt("build a plugin", [{
      id: "ticker:SPX:1",
      kind: "ticker",
      label: "Ticker SPX",
      preview: "S&P 500",
      content: "n".repeat(6_000),
    }]);
    expect(prompt).toContain("truncated");
    expect(prompt.length).toBeLessThan(5_000);
  });

  test("passes completed conversation history as structured messages", () => {
    const thread = {
      id: "thread-1",
      providerId: "anthropic",
      modelId: null,
      title: "Research",
      createdAt: 1,
      updatedAt: 6,
      messages: [
        { id: "u1", role: "user" as const, content: "First question", createdAt: 2 },
        { id: "a1", role: "assistant" as const, content: "Completed answer", createdAt: 3, status: "complete" as const },
        { id: "a2", role: "assistant" as const, content: "Partial cancellation", createdAt: 4, status: "cancelled" as const },
        { id: "a3", role: "assistant" as const, content: "Failed answer", createdAt: 5, status: "error" as const },
        { id: "a4", role: "assistant" as const, content: "Legacy loading answer", createdAt: 6 },
      ],
      agentMessages: [],
    };

    expect(buildLocalAgentHistory(thread)).toEqual([
      { role: "user", content: "First question" },
      { role: "assistant", content: "Completed answer" },
    ]);
    expect(buildLocalAgentTranscript(thread)).toEqual([
      { role: "user", content: "First question" },
      {
        role: "assistant",
        content: [{ type: "text", text: "Completed answer" }],
      },
    ]);
    expect(buildLocalAgentRequestPrompt("Current question", [])).toBe(
      "Current user request:\nCurrent question",
    );
    expect(buildLocalAgentRequestPrompt("Open SEC", [], {
      layoutName: "Democrats",
      focusedPaneId: "ai:main",
      panes: [{
        instanceId: "ai:main",
        paneId: "local-agent-workspace",
        placement: "docked",
        focused: true,
        title: "AI Agent",
      }],
    })).toContain("Do not ask the user to attach panes.");
  });

  test("drops malformed persisted threads and preserves ordered messages", () => {
    const normalized = normalizeLocalAgentWorkspace({
      activeThreadId: "thread-1",
      threads: [{
        id: "thread-1",
        providerId: "claude",
        title: "Research",
        createdAt: 1,
        updatedAt: 3,
        messages: [
          { id: "m1", role: "user", content: "First", createdAt: 2 },
          { id: "m2", role: "assistant", content: "Second", createdAt: 3, status: "complete" },
        ],
      }, {
        id: "bad",
        providerId: "",
        title: "Malformed",
        createdAt: 1,
        updatedAt: 1,
        messages: [],
      }],
    });

    expect(normalized.threads).toHaveLength(1);
    expect(normalized.threads[0]?.messages.map((message) => message.content)).toEqual(["First", "Second"]);
  });

  test("persists native tool history and prefers it over flattened display messages", () => {
    const created = createLocalAgentThread(EMPTY_LOCAL_AGENT_WORKSPACE, "anthropic", {
      id: "thread-1",
      now: 1,
    });
    const withDisplay = appendLocalAgentMessages(created, "thread-1", [
      { id: "u1", role: "user", content: "Open a pane", createdAt: 2 },
      { id: "a1", role: "assistant", content: "Opened it", createdAt: 3, status: "complete" },
    ]);
    const withTranscript = appendLocalAgentTranscript(withDisplay, "thread-1", [
      { role: "user", content: "Current user request:\nOpen a pane" },
      {
        role: "assistant",
        content: [{
          type: "toolCall",
          id: "tool-1",
          name: "gloomberb_remote",
          arguments: { request: { type: "call", operation: "pane.open" } },
        }],
      },
      {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "gloomberb_remote",
        content: [{ type: "text", text: '{"ok":true}' }],
        isError: false,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Opened it" }],
      },
    ]);
    const normalized = normalizeLocalAgentWorkspace(withTranscript);
    const thread = normalized.threads[0];
    if (!thread) throw new Error("Expected a normalized thread");

    expect(buildLocalAgentTranscript(thread).map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant",
    ]);
    expect(buildLocalAgentTranscript(thread)[2]).toMatchObject({
      role: "toolResult",
      toolCallId: "tool-1",
      content: [{ type: "text", text: '{"ok":true}' }],
    });
  });

  test("preserves toolCards on a LocalAgentMessage through normalizeLocalAgentWorkspace", () => {
    const normalized = normalizeLocalAgentWorkspace({
      activeThreadId: "thread-1",
      threads: [{
        id: "thread-1",
        providerId: "anthropic",
        title: "Research",
        createdAt: 1,
        updatedAt: 2,
        messages: [{
          id: "a1",
          role: "assistant",
          content: "Opened it.",
          createdAt: 2,
          status: "complete",
          toolCards: [{
            id: "call-1",
            toolName: "gloomberb_remote",
            arguments: { operation: "pane.open" },
            status: "success",
            isError: false,
            result: '{"ok":true}',
          }],
        }],
      }],
    });

    expect(normalized.threads[0]?.messages[0]?.toolCards).toEqual([{
      id: "call-1",
      toolName: "gloomberb_remote",
      arguments: { operation: "pane.open" },
      status: "success",
      isError: false,
      result: '{"ok":true}',
    }]);
  });

  test("drops malformed toolCards entries without nuking the message", () => {
    const normalized = normalizeLocalAgentWorkspace({
      activeThreadId: "thread-1",
      threads: [{
        id: "thread-1",
        providerId: "anthropic",
        title: "Research",
        createdAt: 1,
        updatedAt: 2,
        messages: [{
          id: "a1",
          role: "assistant",
          content: "Opened it.",
          createdAt: 2,
          status: "complete",
          toolCards: [
            { id: "good", toolName: "tool", arguments: {}, status: "success", isError: false },
            { id: "bad", toolName: 123, arguments: {}, status: "success", isError: false } as unknown as never,
            { id: "also-bad", toolName: "tool", arguments: "not-a-record", status: "success", isError: false } as unknown as never,
          ],
        }],
      }],
    });

    const cards = normalized.threads[0]?.messages[0]?.toolCards;
    expect(cards).toEqual([
      { id: "good", toolName: "tool", arguments: {}, status: "success", isError: false },
    ]);
  });

  test("preserves action receipts through normalizeLocalAgentWorkspace", () => {
    const normalized = normalizeLocalAgentWorkspace({
      activeThreadId: "thread-1",
      threads: [{
        id: "thread-1",
        providerId: "anthropic",
        title: "Research",
        createdAt: 1,
        updatedAt: 2,
        messages: [{
          id: "a1",
          role: "assistant",
          content: "Opened it.",
          createdAt: 2,
          status: "complete",
          receipts: [{
            id: "call-1",
            toolCallId: "call-1",
            toolName: "gloomberb_show",
            operation: "pane.show",
            label: "opened sec",
            undoable: true,
          }],
        }],
      }],
    });
    expect(normalized.threads[0]?.messages[0]?.receipts).toEqual([{
      id: "call-1",
      toolCallId: "call-1",
      toolName: "gloomberb_show",
      operation: "pane.show",
      label: "opened sec",
      undoable: true,
    }]);
  });

  test("preserves assistant thinking and backfills it from native history", () => {
    const withField = normalizeLocalAgentWorkspace({
      activeThreadId: "thread-1",
      threads: [{
        id: "thread-1",
        providerId: "xai",
        title: "Grok",
        createdAt: 1,
        updatedAt: 2,
        messages: [{
          id: "a1",
          role: "assistant",
          content: "Because.",
          createdAt: 2,
          status: "complete",
          thinking: "Need a short reason.",
        }],
      }],
    });
    expect(withField.threads[0]?.messages[0]?.thinking).toBe("Need a short reason.");

    const backfilled = normalizeLocalAgentWorkspace({
      activeThreadId: "thread-1",
      threads: [{
        id: "thread-1",
        providerId: "xai",
        title: "Grok",
        createdAt: 1,
        updatedAt: 2,
        messages: [
          { id: "u1", role: "user", content: "Why?", createdAt: 1 },
          { id: "a1", role: "assistant", content: "Because.", createdAt: 2, status: "complete" },
        ],
        agentMessages: [
          { role: "user", content: "Why?" },
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "Need a short reason." },
              { type: "text", text: "Because." },
            ],
          },
        ],
      }],
    });
    expect(backfilled.threads[0]?.messages[1]?.thinking).toBe("Need a short reason.");
  });
});
