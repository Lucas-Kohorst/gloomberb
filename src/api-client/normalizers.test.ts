import { describe, expect, test } from "bun:test";
import { emptyChatPresence, mergeChatPresence, normalizeChatPresence } from "./normalizers";

describe("normalizeChatPresence", () => {
  test("keeps a count-only payload from wiping a previous user list", () => {
    expect(normalizeChatPresence({ onlineCount: 4 })).toEqual({
      onlineCount: 4,
      onlineUserIds: [],
      onlineUsernames: [],
      hasUserList: false,
    });
    expect(mergeChatPresence({
      onlineCount: 2,
      onlineUserIds: ["u2"],
      onlineUsernames: ["bob"],
      hasUserList: true,
    }, normalizeChatPresence({ onlineCount: 4 }))).toEqual({
      onlineCount: 4,
      onlineUserIds: ["u2"],
      onlineUsernames: ["bob"],
      hasUserList: true,
    });
  });

  test("reads online users from id and username lists", () => {
    expect(normalizeChatPresence({
      onlineCount: 2,
      userIds: ["u2"],
      users: [{ id: "u3", username: "cara" }],
      onlineUsernames: ["bob"],
    })).toEqual({
      onlineCount: 2,
      onlineUserIds: ["u2", "u3"],
      onlineUsernames: ["cara", "bob"],
      hasUserList: true,
    });
  });

  test("treats an explicit empty user list as everyone offline", () => {
    expect(mergeChatPresence({
      ...emptyChatPresence(3),
      onlineUserIds: ["u2"],
      hasUserList: true,
    }, normalizeChatPresence({ onlineCount: 0, userIds: [] }))).toEqual({
      onlineCount: 0,
      onlineUserIds: [],
      onlineUsernames: [],
      hasUserList: true,
    });
  });

  test("reads a websocket envelope that nests the user list under data", () => {
    expect(normalizeChatPresence({
      type: "chat.presence",
      data: {
        onlineCount: 2,
        userIds: [2, "u3"],
        usernames: ["bob"],
      },
    })).toEqual({
      onlineCount: 2,
      onlineUserIds: ["2", "u3"],
      onlineUsernames: ["bob"],
      hasUserList: true,
    });
  });

  test("reads snake_case presence lists and numeric ids", () => {
    expect(normalizeChatPresence({
      online_count: 1,
      online_user_ids: [42],
      online_usernames: ["bob"],
    })).toEqual({
      onlineCount: 1,
      onlineUserIds: ["42"],
      onlineUsernames: ["bob"],
      hasUserList: true,
    });
  });
});
