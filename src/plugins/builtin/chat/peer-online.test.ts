import { describe, expect, test } from "bun:test";
import type { ChatChannel } from "../../../api-client";
import { isChatUserOnline, isDirectPeerOnline, isGroupChannelOnline } from "./peer-online";

const bob: ChatChannel = {
  id: "dm:bob",
  name: "@bob",
  kind: "direct",
  created_at: "2026-07-03T09:30:00.000Z",
  dmUser: { id: "u2", username: "bob", displayName: "Bob" },
};

describe("isDirectPeerOnline", () => {
  test("matches a direct peer by user id, username, or online flag", () => {
    expect(isDirectPeerOnline(bob, { onlineUserIds: ["u2"] })).toBe(true);
    expect(isDirectPeerOnline(bob, { onlineUsernames: ["Bob"] })).toBe(true);
    expect(isDirectPeerOnline({
      ...bob,
      dmUser: { ...bob.dmUser!, online: true },
    }, {})).toBe(true);
    expect(isDirectPeerOnline(bob, { onlineUserIds: ["u9"] })).toBe(false);
  });

  test("does not mark public channels or groups online", () => {
    expect(isDirectPeerOnline({
      id: "everyone",
      name: "everyone",
      created_at: "2026-03-26T12:10:05.684Z",
    }, { onlineUserIds: ["u2"] })).toBe(false);
    expect(isDirectPeerOnline({
      id: "grp:vista",
      name: "VistaDex trading",
      kind: "group",
      created_at: "2026-07-03T09:31:00.000Z",
      members: [bob.dmUser!],
    }, { onlineUserIds: ["u2"] })).toBe(false);
  });
});

describe("isChatUserOnline", () => {
  test("matches controller presence by user id or username", () => {
    expect(isChatUserOnline({ id: "u2", username: "bob", displayName: "Bob" }, { onlineUserIds: ["u2"] })).toBe(true);
    expect(isChatUserOnline({ id: "u2", username: "bob", displayName: "Bob" }, { onlineUsernames: ["Bob"] })).toBe(true);
    expect(isChatUserOnline({ id: "u9", username: "cara", displayName: "Cara" }, { onlineUserIds: ["u2"] })).toBe(false);
  });
});

describe("isGroupChannelOnline", () => {
  test("marks a group online when any member is in controller presence", () => {
    const group: ChatChannel = {
      id: "grp:vista",
      name: "VistaDex trading",
      kind: "group",
      created_at: "2026-07-03T09:31:00.000Z",
      members: [bob.dmUser!],
    };
    expect(isGroupChannelOnline(group, { onlineUserIds: ["u2"] })).toBe(true);
    expect(isGroupChannelOnline(group, { onlineUserIds: ["u9"] })).toBe(false);
  });
});
