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
});
