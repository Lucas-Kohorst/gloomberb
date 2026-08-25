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
  installServerChannels,
  type ChatTestSetup,
} from "./test-harness";
import { UnreadInboxPane } from "./unread-inbox-pane";

let testSetup: ChatTestSetup | undefined;
function setup(): ChatTestSetup {
  if (!testSetup) throw new Error("unread inbox pane test setup is missing");
  return testSetup;
}
const { flushFrame } = createChatTestControls(setup);

const CHANNEL_MENTION: ChatMessage = {
  id: "m1",
  channelId: "everyone",
  content: "pinging @vince before the bell",
  replyToId: null,
  createdAt: "2026-03-28T00:00:00.000Z",
  user: { id: "u2", username: "bob", displayName: "Bob" },
};

async function renderUnreadInbox(seed: "mention" | "help-uncached" = "mention") {
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
    if (seed === "help-uncached") {
      installServerChannels(controller);
      const help = (controller as any).storage.ensureChannelState("help");
      help.unreadCount = 1;
      return;
    }
    (controller as any).mergeMessages([CHANNEL_MENTION]);
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
  return { created, dispatched, focused };
}

function expectOpenedExistingChat(
  dispatched: AppAction[],
  focused: string[],
  created: unknown[],
  expected: { channelId: string; targetMessageId?: string },
) {
  expect(created).toEqual([]);
  // Plugin focusPane persistLayout can replay the pre-click layout and reopen Unread.
  expect(focused).toEqual([]);
  expect(dispatched.some((action) => action.type === "FOCUS_PANE" && action.paneId === "chat:main")).toBe(true);
  const configAction = dispatched.find((action) => action.type === "SET_CONFIG");
  expect(configAction?.type).toBe("SET_CONFIG");
  if (configAction?.type !== "SET_CONFIG") throw new Error("expected SET_CONFIG");
  const chat = configAction.config.layout.instances.find((instance) => instance.paneId === "chat");
  expect(chat?.settings?.channelId).toBe(expected.channelId);
  expect(chat?.settings?.targetMessageId).toBe(expected.targetMessageId);
}

describe("unread inbox pane", () => {
  afterEach(async () => {
    await cleanupChatTest(testSetup);
    testSetup = undefined;
  });

  test("clicking an unread row jumps the existing chat pane to that message", async () => {
    const { created, dispatched, focused } = await renderUnreadInbox();

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

    expectOpenedExistingChat(dispatched, focused, created, {
      channelId: "everyone",
      targetMessageId: "m1",
    });
  });

  test("enter opens the selected channel mention", async () => {
    // Regression: ListView only activated on click, so a focused Unread pane
    // ignored Enter on public channels like #everyone.
    const { created, dispatched, focused } = await renderUnreadInbox();

    expect(setup().captureCharFrame()).toContain("#everyone");

    await act(async () => {
      setup().mockInput.pressEnter();
      await setup().renderOnce();
      await setup().renderOnce();
    });

    expectOpenedExistingChat(dispatched, focused, created, {
      channelId: "everyone",
      targetMessageId: "m1",
    });
  });

  test("clicking a channel-only unread row opens that channel", async () => {
    // `#help unread` is the uncached row (no message id). Click used plugin
    // focusPane, which replayed a stale layout and left Unread open.
    const { created, dispatched, focused } = await renderUnreadInbox("help-uncached");

    const frame = setup().captureCharFrame();
    expect(frame).toContain("#help");
    expect(frame).toContain("unread");
    const line = frame.split("\n").find((entry) => entry.includes("#help")) ?? "";
    const clickCol = Math.max(0, line.indexOf("#help"));

    await act(async () => {
      await setup().mockMouse.click(clickCol + 1, 0);
      await setup().renderOnce();
      await setup().renderOnce();
    });

    expectOpenedExistingChat(dispatched, focused, created, { channelId: "help" });
  });
});
