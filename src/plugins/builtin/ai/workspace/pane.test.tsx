import { afterEach, describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { PaneFooterProvider } from "../../../../components/layout/pane/footer";
import { testRender } from "../../../../renderers/opentui/test-utils";
import {
  AppContext,
  PaneInstanceProvider,
  createInitialState,
} from "../../../../state/app/context";
import { createStatefulTestPluginRuntime } from "../../../../test-support/plugin-runtime";
import { createDefaultConfig, createPaneInstance } from "../../../../types/config";
import { Box } from "../../../../ui";
import { PluginRenderProvider, type PluginRuntimeAccess } from "../../../runtime";
import { setAiRunHost, setAiRuntimeCatalog } from "../runner";
import { setInProcessRemoteHandle } from "../../../../remote/in-process-handle";
import type { RemoteControlRequest } from "../../../../remote/types";
import {
  LOCAL_AGENT_WORKSPACE_SCHEMA_VERSION,
  LOCAL_AGENT_WORKSPACE_STATE_KEY,
  LocalAgentWorkspacePane,
} from "./pane";
import {
  createLocalAgentThread,
  EMPTY_LOCAL_AGENT_WORKSPACE,
  type LocalAgentWorkspaceState,
} from "./model";

const PANE_ID = "local-agent-workspace:test";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

function AgentPaneHarness({
  existingWorkspace,
  newThreadId,
  onOpenSettings,
  onShowPane,
  runtimeRef,
}: {
  existingWorkspace?: LocalAgentWorkspaceState;
  newThreadId?: string;
  onOpenSettings?: PluginRuntimeAccess["openPaneSettings"];
  onShowPane?: PluginRuntimeAccess["showPane"];
  runtimeRef?: { current: PluginRuntimeAccess | null };
}) {
  const [state] = useState(() => {
    const config = createDefaultConfig("/tmp/gloomberb-agent-pane");
    config.layout.instances.push(createPaneInstance("local-agent-workspace", {
      instanceId: PANE_ID,
      title: "AI Agent",
      ...(newThreadId ? { params: { newThreadId } } : {}),
    }));
    const initial = createInitialState(config);
    initial.focusedPaneId = PANE_ID;
    return initial;
  });
  const [runtime] = useState(() => {
    const nextRuntime = createStatefulTestPluginRuntime({
      openPaneSettings: onOpenSettings,
      showPane: onShowPane,
    });
    if (existingWorkspace) {
      nextRuntime.setResumeState(
        "ai",
        LOCAL_AGENT_WORKSPACE_STATE_KEY,
        existingWorkspace,
        LOCAL_AGENT_WORKSPACE_SCHEMA_VERSION,
      );
    }
    if (runtimeRef) runtimeRef.current = nextRuntime;
    return nextRuntime;
  });

  return (
    <Box flexDirection="column" width={100} height={16}>
      <AppContext value={{ state, dispatch: () => {} }}>
        <PaneInstanceProvider paneId={PANE_ID}>
          <PluginRenderProvider pluginId="ai" runtime={runtime}>
            <PaneFooterProvider>
              {() => (
                <LocalAgentWorkspacePane
                  paneId={PANE_ID}
                  paneType="local-agent-workspace"
                  focused
                  width={100}
                  height={16}
                />
              )}
            </PaneFooterProvider>
          </PluginRenderProvider>
        </PaneInstanceProvider>
      </AppContext>
    </Box>
  );
}

afterEach(async () => {
  if (testSetup) {
    await act(async () => {
      testSetup?.renderer.destroy();
    });
    testSetup = undefined;
  }
  setAiRuntimeCatalog({ providers: [], accounts: [], models: [] });
  setAiRunHost(null);
  setInProcessRemoteHandle(null);
});

describe("LocalAgentWorkspacePane provider setup", () => {
  test("starts a chat with a ready provider instead of a setup screen", async () => {
    setAiRuntimeCatalog({
      providers: [{
        providerId: "openai-codex",
        label: "OpenAI (ChatGPT)",
        status: "ready",
        outputModes: ["plain", "structured", "screener"],
      }],
      accounts: [{
        providerId: "openai-codex",
        providerLabel: "OpenAI (ChatGPT)",
        connectionState: "connected",
        connectionLabel: "Connected",
        authMethods: [],
        canLogin: false,
        canDisconnect: true,
      }],
      models: [],
    });

    testSetup = await testRender(
      <AgentPaneHarness />,
      { width: 100, height: 16 },
    );
    await act(async () => {
      await testSetup!.renderOnce();
      await Promise.resolve();
      await testSetup!.renderOnce();
      await Promise.resolve();
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Message OpenAI");
    expect(frame).toContain("This desk is already in context");
    expect(frame).not.toContain("Choose an AI provider");
    expect(frame).not.toContain("No financial context is attached automatically");
    expect(frame).not.toContain("Attach selected ticker");
  });

  test("shows disconnected providers, prefers a ready account, and opens Account Management", async () => {
    setAiRuntimeCatalog({
      providers: [
        {
          providerId: "anthropic",
          label: "Claude",
          status: "not_authenticated",
          unavailableReason: "Claude is not connected.",
          outputModes: ["plain", "structured", "screener"],
        },
        {
          providerId: "openai-codex",
          label: "OpenAI (ChatGPT)",
          status: "ready",
          outputModes: ["plain", "structured", "screener"],
        },
      ],
      accounts: [],
      models: [],
    });

    const openedPanes: string[] = [];
    testSetup = await testRender(
      <AgentPaneHarness
        existingWorkspace={createLocalAgentThread(
          EMPTY_LOCAL_AGENT_WORKSPACE,
          "openai-codex",
          { id: "existing-thread", now: 1 },
        )}
        newThreadId="new-pane-thread"
        onShowPane={(paneId) => {
          openedPanes.push(paneId);
        }}
      />,
      { width: 100, height: 16 },
    );
    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const readyFrame = testSetup.captureCharFrame();
    expect(readyFrame).toContain("OpenAI (ChatGPT)");
    expect(readyFrame).toContain("OpenAI (ChatGPT) is ready.");
    const providerRow = readyFrame.split("\n").findIndex((line) => (
      line.trim() === "OpenAI (ChatGPT)"
    ));
    const providerColumn = readyFrame.split("\n")[providerRow]?.indexOf("OpenAI (ChatGPT)") ?? -1;
    expect(providerRow).toBeGreaterThanOrEqual(0);
    expect(providerColumn).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.click(providerColumn + 1, providerRow);
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });
    const providerPickerFrame = testSetup.captureCharFrame();
    expect(providerPickerFrame).toContain("Choose AI provider");
    expect(providerPickerFrame).toContain("Claude · sign in");

    await act(async () => {
      testSetup?.renderer.destroy();
    });
    testSetup = undefined;
    setAiRuntimeCatalog({
      providers: [{
        providerId: "anthropic",
        label: "Claude",
        status: "not_authenticated",
        unavailableReason: "Claude is not connected.",
        outputModes: ["plain", "structured", "screener"],
      }],
      accounts: [],
      models: [],
    });

    testSetup = await testRender(
      <AgentPaneHarness onShowPane={(paneId) => {
        openedPanes.push(paneId);
      }} />,
      { width: 100, height: 16 },
    );
    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const disconnectedFrame = testSetup.captureCharFrame();
    expect(disconnectedFrame).toContain("Claude is not connected.");
    expect(disconnectedFrame).toContain("Sign in from Account Management");

    await act(async () => {
      testSetup!.mockInput.pressKey("s");
      await testSetup!.renderOnce();
    });

    expect(openedPanes).toEqual(["account-management"]);
  });
});

describe("LocalAgentWorkspacePane tool cards", () => {
  test("renders a collapsed success tool card header", async () => {
    setAiRuntimeCatalog({
      providers: [{
        providerId: "xai",
        label: "xAI / Grok",
        status: "ready",
        outputModes: ["plain", "structured"],
      }],
      accounts: [{
        providerId: "xai",
        providerLabel: "xAI / Grok",
        connectionState: "connected",
        connectionLabel: "Connected",
        authMethods: [],
        canLogin: false,
        canDisconnect: true,
      }],
      models: [],
    });

    testSetup = await testRender(
      <AgentPaneHarness
        existingWorkspace={{
          activeThreadId: "thread-1",
          threads: [{
            id: "thread-1",
            providerId: "xai",
            modelId: "grok-4",
            title: "Open it",
            createdAt: 1,
            updatedAt: 2,
            messages: [
              { id: "u1", role: "user", content: "Open the watchlist", createdAt: 1 },
              {
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
              },
            ],
            agentMessages: [],
          }],
        }}
      />,
      { width: 100, height: 16 },
    );
    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("gloomberb_remote");
    expect(frame).toContain("success");
    // Collapsed by default: arguments/result not shown.
    expect(frame).not.toContain("Arguments:");
    expect(frame).not.toContain('{"ok":true}');
  });

  test("renders an error status tool card header", async () => {
    setAiRuntimeCatalog({
      providers: [{
        providerId: "xai",
        label: "xAI / Grok",
        status: "ready",
        outputModes: ["plain", "structured"],
      }],
      accounts: [{
        providerId: "xai",
        providerLabel: "xAI / Grok",
        connectionState: "connected",
        connectionLabel: "Connected",
        authMethods: [],
        canLogin: false,
        canDisconnect: true,
      }],
      models: [],
    });

    testSetup = await testRender(
      <AgentPaneHarness
        existingWorkspace={{
          activeThreadId: "thread-1",
          threads: [{
            id: "thread-1",
            providerId: "xai",
            modelId: "grok-4",
            title: "Bad cmd",
            createdAt: 1,
            updatedAt: 2,
            messages: [
              { id: "u1", role: "user", content: "Run a bad command", createdAt: 1 },
              {
                id: "a1",
                role: "assistant",
                content: "It failed.",
                createdAt: 2,
                status: "complete",
                toolCards: [{
                  id: "call-err",
                  toolName: "gloomberb_cli",
                  arguments: { cmd: "bad" },
                  status: "error",
                  isError: true,
                  result: "command not found",
                }],
              },
            ],
            agentMessages: [],
          }],
        }}
      />,
      { width: 100, height: 16 },
    );
    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("gloomberb_cli");
    expect(frame).toContain("error");
  });
});

describe("LocalAgentWorkspacePane receipts", () => {
  test("renders an undoable receipt and calls layout.undo", async () => {
    const requests: RemoteControlRequest[] = [];
    setInProcessRemoteHandle(async (request) => {
      requests.push(request);
      return { ok: true, data: {} };
    });
    setAiRuntimeCatalog({
      providers: [{
        providerId: "xai",
        label: "xAI / Grok",
        status: "ready",
        outputModes: ["plain", "structured"],
      }],
      accounts: [{
        providerId: "xai",
        providerLabel: "xAI / Grok",
        connectionState: "connected",
        connectionLabel: "Connected",
        authMethods: [],
        canLogin: false,
        canDisconnect: true,
      }],
      models: [],
    });

    testSetup = await testRender(
      <AgentPaneHarness
        existingWorkspace={{
          activeThreadId: "thread-1",
          threads: [{
            id: "thread-1",
            providerId: "xai",
            modelId: "grok-4",
            title: "Open it",
            createdAt: 1,
            updatedAt: 2,
            messages: [
              { id: "u1", role: "user", content: "Open SEC", createdAt: 1 },
              {
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
              },
            ],
            agentMessages: [],
          }],
        }}
      />,
      { width: 100, height: 16 },
    );
    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("opened sec");
    expect(frame).toContain("Undo");
    const undoRow = frame.split("\n").findIndex((line) => line.includes("Undo"));
    const undoColumn = frame.split("\n")[undoRow]?.indexOf("Undo") ?? -1;
    expect(undoRow).toBeGreaterThanOrEqual(0);
    expect(undoColumn).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.click(undoColumn + 1, undoRow);
      await testSetup!.renderOnce();
    });
    expect(requests).toEqual([{ type: "call", operation: "layout.undo" }]);
  });
});

describe("LocalAgentWorkspacePane new threads", () => {
  test("clones the current provider instead of opening the chooser", async () => {
    setAiRuntimeCatalog({
      providers: [{
        providerId: "xai",
        label: "xAI / Grok",
        status: "ready",
        outputModes: ["plain", "structured"],
      }],
      accounts: [{
        providerId: "xai",
        providerLabel: "xAI / Grok",
        connectionState: "connected",
        connectionLabel: "Connected",
        authMethods: [],
        canLogin: false,
        canDisconnect: true,
      }],
      models: [],
    });

    testSetup = await testRender(
      <AgentPaneHarness
        existingWorkspace={{
          activeThreadId: "thread-1",
          threads: [{
            id: "thread-1",
            providerId: "xai",
            modelId: "grok-4",
            title: "create a demo...",
            createdAt: 1,
            updatedAt: 2,
            messages: [
              { id: "u1", role: "user", content: "create a democrats layout", createdAt: 1 },
              { id: "a1", role: "assistant", content: "Opened it.", createdAt: 2, status: "complete" },
            ],
            agentMessages: [],
          }],
        }}
      />,
      { width: 100, height: 16 },
    );
    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const before = testSetup.captureCharFrame();
    const newRow = before.split("\n").findIndex((line) => line.includes("+ New"));
    const newColumn = before.split("\n")[newRow]?.indexOf("+ New") ?? -1;
    expect(newRow).toBeGreaterThanOrEqual(0);
    expect(newColumn).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.click(newColumn + 1, newRow);
      await testSetup!.renderOnce();
      await Promise.resolve();
      await testSetup!.renderOnce();
      await Promise.resolve();
      await testSetup!.renderOnce();
    });

    const after = testSetup.captureCharFrame();
    expect(after).toContain("Message xAI");
    expect(after).toContain("This desk is already in context");
    expect(after).not.toContain("Choose an AI provider");
    expect(after).not.toContain("create a democrats layout");
  });
});

describe("LocalAgentWorkspacePane thinking", () => {
  test("keeps assistant thinking collapsed in the thread", async () => {
    setAiRuntimeCatalog({
      providers: [{
        providerId: "xai",
        label: "xAI / Grok",
        status: "ready",
        outputModes: ["plain", "structured"],
      }],
      accounts: [{
        providerId: "xai",
        providerLabel: "xAI / Grok",
        connectionState: "connected",
        connectionLabel: "Connected",
        authMethods: [],
        canLogin: false,
        canDisconnect: true,
      }],
      models: [],
    });

    testSetup = await testRender(
      <AgentPaneHarness
        existingWorkspace={{
          activeThreadId: "thread-1",
          threads: [{
            id: "thread-1",
            providerId: "xai",
            modelId: "grok-4",
            title: "Why?",
            createdAt: 1,
            updatedAt: 2,
            messages: [
              { id: "u1", role: "user", content: "Why?", createdAt: 1 },
              {
                id: "a1",
                role: "assistant",
                content: "Because.",
                createdAt: 2,
                status: "complete",
                thinking: "Need a short reason.",
              },
            ],
            agentMessages: [],
          }],
        }}
      />,
      { width: 100, height: 16 },
    );
    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const collapsed = testSetup.captureCharFrame();
    expect(collapsed).toContain("▸ Thinking");
    expect(collapsed).toContain("Because.");
    expect(collapsed).not.toContain("Need a short reason.");
  });
});

describe("LocalAgentWorkspacePane unmount", () => {
  test("keeps an in-flight run and persists the completed reply after unmount", async () => {
    const runtimeRef: { current: PluginRuntimeAccess | null } = { current: null };
    let cancelCalled = false;
    let resolveRun!: (value: string) => void;
    let startedRun!: () => void;
    const started = new Promise<void>((resolve) => {
      startedRun = resolve;
    });
    const done = new Promise<string>((resolve) => {
      resolveRun = resolve;
    });
    setAiRuntimeCatalog({
      providers: [{
        providerId: "xai",
        label: "xAI / Grok",
        status: "ready",
        outputModes: ["plain", "structured"],
      }],
      accounts: [{
        providerId: "xai",
        providerLabel: "xAI / Grok",
        connectionState: "connected",
        connectionLabel: "Connected",
        authMethods: [],
        canLogin: false,
        canDisconnect: true,
      }],
      models: [],
    });
    setAiRunHost({
      async checkStatus() {
        return { available: true, authenticated: true, message: null };
      },
      run() {
        startedRun();
        return {
          done,
          cancel() {
            cancelCalled = true;
          },
        };
      },
    });

    testSetup = await testRender(
      <AgentPaneHarness
        runtimeRef={runtimeRef}
        existingWorkspace={{
          activeThreadId: "thread-1",
          threads: [{
            id: "thread-1",
            providerId: "xai",
            modelId: "grok-4",
            title: "Desk",
            createdAt: 1,
            updatedAt: 2,
            messages: [],
            agentMessages: [],
          }],
        }}
      />,
      { width: 100, height: 16 },
    );
    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    const inputRow = frame.split("\n").findIndex((line) => line.includes("Message xAI"));
    const inputCol = frame.split("\n")[inputRow]?.indexOf(">") ?? -1;
    expect(inputRow).toBeGreaterThanOrEqual(0);
    expect(inputCol).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.click(inputCol, inputRow);
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
      testSetup!.mockInput.pressEnter();
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });
    await act(async () => {
      await testSetup!.mockInput.typeText("open the desk");
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });
    expect(testSetup.captureCharFrame()).toContain("open the desk");
    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await Promise.resolve();
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });
    await started;

    await act(async () => {
      testSetup?.renderer.destroy();
    });
    testSetup = undefined;

    expect(cancelCalled).toBe(false);

    resolveRun('{"type":"layout.new"}');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(cancelCalled).toBe(false);
    const workspace = runtimeRef.current?.getResumeState<LocalAgentWorkspaceState>(
      "ai",
      LOCAL_AGENT_WORKSPACE_STATE_KEY,
      LOCAL_AGENT_WORKSPACE_SCHEMA_VERSION,
    );
    const assistant = workspace?.threads[0]?.messages.find((message) => message.role === "assistant");
    expect(assistant?.content).toBe('{"type":"layout.new"}');
    expect(assistant?.status).toBe("complete");
  });
});
