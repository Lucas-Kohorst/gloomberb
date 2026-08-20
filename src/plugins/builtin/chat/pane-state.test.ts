import { describe, expect, test } from "bun:test";
import { createDefaultConfig } from "../../../types/config";
import { LAST_VISITED_CHAT_CHANNEL_KEY } from "./channels";
import {
  applyUnreadInboxItemToConfig,
  clearChatPaneTargetMessage,
  setChatPaneChannel,
  setChatPaneJump,
} from "./pane-state";

describe("chat pane state", () => {
  test("preserves an exact-message target while the current channel metadata updates", () => {
    expect(setChatPaneChannel({
      channelId: "direct:vincent:mika",
      targetMessageId: "message-42",
    }, "direct:vincent:mika")).toEqual({
      channelId: "direct:vincent:mika",
      targetMessageId: "message-42",
    });
  });

  test("clears an exact-message target when the user changes channels", () => {
    expect(setChatPaneChannel({
      channelId: "direct:vincent:mika",
      targetMessageId: "message-42",
    }, "everyone")).toEqual({ channelId: "everyone" });
  });

  test("clears the target only after the message jump is handled", () => {
    expect(clearChatPaneTargetMessage({
      channelId: "direct:vincent:mika",
      targetMessageId: "message-42",
    })).toEqual({ channelId: "direct:vincent:mika" });
  });

  test("reapplies a message jump after a channel switch", () => {
    expect(setChatPaneJump({
      channelId: "direct:vincent:mika",
      targetMessageId: "message-42",
    }, "everyone", "message-99")).toEqual({
      channelId: "everyone",
      targetMessageId: "message-99",
    });
  });

  test("jumps the existing chat pane to an unread message", () => {
    const config = createDefaultConfig("/tmp/gloomberb-unread");
    const result = applyUnreadInboxItemToConfig(config, {
      channelId: "equities",
      messageId: "m-42",
      paneTitle: "#equities",
    });
    expect(result.chatInstanceId).toBe("chat:main");
    const chat = result.config.layout.instances.find((instance) => instance.paneId === "chat");
    expect(chat?.title).toBe("#equities");
    expect(chat?.settings).toEqual({
      hideTabs: false,
      channelId: "equities",
      targetMessageId: "m-42",
    });
    expect(result.config.pluginConfig["gloomberb-cloud"]?.[LAST_VISITED_CHAT_CHANNEL_KEY]).toBe("equities");
  });

  test("closes the unread inbox in the same layout write", () => {
    const config = createDefaultConfig("/tmp/gloomberb-unread");
    config.layout.instances.push({
      instanceId: "unread-inbox:test",
      paneId: "unread-inbox",
      binding: { kind: "none" },
    });
    config.layout.floating.push({
      instanceId: "unread-inbox:test",
      x: 0,
      y: 0,
      width: 56,
      height: 16,
    });
    const result = applyUnreadInboxItemToConfig(config, {
      channelId: "everyone",
      messageId: "m1",
      paneTitle: "#everyone",
    }, "unread-inbox:test");
    expect(result.config.layout.instances.some((instance) => instance.instanceId === "unread-inbox:test")).toBe(false);
    expect(result.config.layout.floating.some((entry) => entry.instanceId === "unread-inbox:test")).toBe(false);
  });
});
