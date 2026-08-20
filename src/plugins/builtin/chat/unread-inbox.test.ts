import { describe, expect, test } from "bun:test";
import type { ChatChannel, ChatMessage } from "../../../api-client";
import {
  formatUnreadInboxRowLabel,
  listUnreadInboxItems,
  type UnreadInboxChannelState,
} from "./unread-inbox";

const user = { id: "u1", username: "vince" };

function message(overrides: Partial<ChatMessage> & Pick<ChatMessage, "id" | "content" | "createdAt">): ChatMessage {
  return {
    channelId: overrides.channelId ?? "everyone",
    replyToId: null,
    user: overrides.user ?? { id: "u2", username: "bob", displayName: "Bob" },
    ...overrides,
  };
}

function everyone(): ChatChannel {
  return { id: "everyone", name: "everyone", created_at: "2026-03-26T12:10:05.684Z" };
}

describe("listUnreadInboxItems", () => {
  test("returns nothing when every channel is caught up", () => {
    const states: UnreadInboxChannelState[] = [{
      channelId: "everyone",
      unreadCount: 0,
      lastViewedMessageId: "m1",
      messages: [message({ id: "m1", content: "hey @vince", createdAt: "2026-03-28T00:00:00.000Z" })],
    }];
    expect(listUnreadInboxItems({ channels: [everyone()], states, user })).toEqual([]);
  });

  test("lists unread mention messages newest first", () => {
    const states: UnreadInboxChannelState[] = [{
      channelId: "everyone",
      unreadCount: 2,
      lastViewedMessageId: "m0",
      messages: [
        message({ id: "m0", content: "old", createdAt: "2026-03-28T00:00:00.000Z" }),
        message({ id: "m1", content: "pinging @vince first", createdAt: "2026-03-28T00:01:00.000Z" }),
        message({ id: "m2", content: "pinging @vince again", createdAt: "2026-03-28T00:02:00.000Z" }),
      ],
    }];
    const items = listUnreadInboxItems({ channels: [everyone()], states, user });
    expect(items.map((item) => item.messageId)).toEqual(["m2", "m1"]);
    expect(items[0]?.channelLabel).toBe("#everyone");
    expect(formatUnreadInboxRowLabel(items[0]!)).toContain("@bob: pinging @vince again");
  });

  test("falls back to the latest unread when there is no mention", () => {
    const states: UnreadInboxChannelState[] = [{
      channelId: "everyone",
      unreadCount: 2,
      lastViewedMessageId: "m0",
      messages: [
        message({ id: "m0", content: "old", createdAt: "2026-03-28T00:00:00.000Z" }),
        message({ id: "m1", content: "first unread", createdAt: "2026-03-28T00:01:00.000Z" }),
        message({ id: "m2", content: "latest unread", createdAt: "2026-03-28T00:02:00.000Z" }),
      ],
    }];
    const items = listUnreadInboxItems({ channels: [everyone()], states, user });
    expect(items).toHaveLength(1);
    expect(items[0]?.messageId).toBe("m2");
    expect(items[0]?.preview).toBe("latest unread");
  });

  test("keeps a channel row when unread exists but messages are not cached", () => {
    const states: UnreadInboxChannelState[] = [{
      channelId: "everyone",
      unreadCount: 3,
      lastViewedMessageId: null,
      messages: [],
    }];
    const items = listUnreadInboxItems({ channels: [everyone()], states, user });
    expect(items).toEqual([expect.objectContaining({
      id: "everyone:unread",
      channelId: "everyone",
      messageId: null,
      unreadInChannel: 3,
    })]);
    expect(formatUnreadInboxRowLabel(items[0]!)).toBe("#everyone  3 unread");
  });

  test("orders mixed channels by the newest message", () => {
    const dm: ChatChannel = {
      id: "dm:bob",
      name: "@bob",
      kind: "direct",
      created_at: "2026-05-27T10:30:03.712Z",
      dmUser: { id: "u2", username: "bob", displayName: "Bob" },
    };
    const items = listUnreadInboxItems({
      channels: [everyone(), dm],
      user,
      states: [
        {
          channelId: "everyone",
          unreadCount: 1,
          lastViewedMessageId: null,
          messages: [message({
            id: "pub-1",
            content: "older @vince",
            createdAt: "2026-03-28T00:00:00.000Z",
          })],
        },
        {
          channelId: "dm:bob",
          unreadCount: 1,
          lastViewedMessageId: null,
          messages: [message({
            id: "dm-1",
            channelId: "dm:bob",
            content: "private ping",
            createdAt: "2026-05-27T10:31:00.000Z",
          })],
        },
      ],
    });
    expect(items.map((item) => item.channelId)).toEqual(["dm:bob", "everyone"]);
  });
});
