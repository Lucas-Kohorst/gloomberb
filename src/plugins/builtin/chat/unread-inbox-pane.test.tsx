import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "../../../renderers/opentui/test-utils";
import {
  AppContext,
  createInitialState,
  PaneInstanceProvider,
  type AppAction,
} from "../../../state/app/context";
import { createTestPluginRuntime } from "../../../test-support/plugin-runtime";
import { createDefaultConfig } from "../../../types/config";
import type { ChatMessage } from "../../../api-client";
import { PluginRenderProvider } from "../../runtime";
import {
  cleanupChatTest,
  createChatTestControls,
  createController,
  type ChatTestSetup,
} from "./test-harness";
import { UnreadInboxPane } from "./unread-inbox-pane";

let testSetup: ChatTestSetup | undefined;
function setup(): ChatTestSetup {
  if (!testSetup) throw new Error("unread inbox pane test setup is missing");
  return testSetup;
}
const { flushFrame } = createChatTestControls(setup);

describe("unread inbox pane", () => {
  afterEach(async () => {
    await cleanupChatTest(testSetup);
    testSetup = undefined;
  });

  test("clicking an unread row jumps the existing chat pane to that message", async () => {
    const controller = createController({
      sessionToken: "token-123",
      user: { id: "u1", username: "vince", emailVerified: true },
    });
    const focused: string[] = [];
    const created: Array<{ templateId: string; options?: { arg?: string } }> = [];
    const dispatched: AppAction[] = [];
    const state = createInitialState(createDefaultConfig("/tmp/gloomberb-unread-pane"));
    const runtime = createTestPluginRuntime({
      createPaneFromTemplate(templateId: string, options?: { arg?: string }) {
        created.push({ templateId, options });
      },
      focusPane(paneId: string) {
        focused.push(paneId);
      },
    });

    await act(async () => {
      (controller as any).mergeMessages([{
        id: "m1",
        channelId: "everyone",
        content: "pinging @vince before the bell",
        replyToId: null,
        createdAt: "2026-03-28T00:00:00.000Z",
        user: { id: "u2", username: "bob", displayName: "Bob" },
      } satisfies ChatMessage]);
    });

    await act(async () => {
      testSetup = await testRender(
        <AppContext value={{
          state,
          dispatch: (action) => {
            dispatched.push(action);
            if (action.type === "SET_CONFIG") state.config = action.config;
          },
        }}
        >
          <PluginRenderProvider pluginId="gloomberb-cloud" runtime={runtime}>
            <PaneInstanceProvider paneId="unread-inbox:test">
              <UnreadInboxPane controller={controller} width={56} height={12} focused />
            </PaneInstanceProvider>
          </PluginRenderProvider>
        </AppContext>,
        { width: 56, height: 12 },
      );
    });

    await flushFrame();

    const frame = setup().captureCharFrame();
    expect(frame).toContain("#everyone");
    expect(frame).toContain("pinging @vince before the bell");

    const line = frame.split("\n").find((entry) => entry.includes("pinging @vince")) ?? "";
    const clickCol = line.indexOf("pinging");
    expect(clickCol).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await setup().mockMouse.click(clickCol + 1, 0);
      await setup().renderOnce();
      await setup().renderOnce();
    });

    expect(created).toEqual([]);
    expect(focused).toEqual(["chat:main"]);
    const configAction = dispatched.find((action) => action.type === "SET_CONFIG");
    expect(configAction?.type).toBe("SET_CONFIG");
    if (configAction?.type !== "SET_CONFIG") throw new Error("expected SET_CONFIG");
    const chat = configAction.config.layout.instances.find((instance) => instance.paneId === "chat");
    expect(chat?.settings?.channelId).toBe("everyone");
    expect(chat?.settings?.targetMessageId).toBe("m1");
  });
});
