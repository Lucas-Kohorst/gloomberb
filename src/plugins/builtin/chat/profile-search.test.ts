import { afterEach, describe, expect, test } from "bun:test";
import { clearPendingChatProfile } from "./profile-request";
import type { ChatChannel, ChatMessage, ChatUserSummary } from "../../../api-client";
import {
  buildWhoCommandResults,
  collectKnownChatUsers,
  openChatProfileFromCommand,
} from "./profile-search";
import { chatController } from "./controller";

afterEach(() => {
  clearPendingChatProfile();
});

const bob: ChatUserSummary = {
  id: "u2",
  username: "bob",
  displayName: "Bob",
  bio: "Trades energy",
  company: "Gloom",
  profilePublic: true,
};

const channels: ChatChannel[] = [
  { id: "everyone", name: "everyone", created_at: "2026-03-26T12:10:05.684Z" },
  {
    id: "dm:bob",
    name: "@bob",
    kind: "direct",
    created_at: "2026-07-03T09:30:00.000Z",
    dmUser: bob,
  },
];

const messages: ChatMessage[] = [{
  id: "m1",
  channelId: "everyone",
  content: "hello",
  replyToId: null,
  createdAt: "2026-07-03T09:31:00.000Z",
  user: bob,
}];

describe("collectKnownChatUsers", () => {
  test("indexes message authors and direct peers", () => {
    expect(collectKnownChatUsers(channels, messages).map((user) => user.username)).toEqual(["bob"]);
  });
});

const privateCara: ChatUserSummary = {
  id: "u3",
  username: "cara",
  displayName: "Cara",
  bio: "Keeps this private",
  profilePublic: false,
};

describe("buildWhoCommandResults", () => {
  test("searching a known username opens that public profile", () => {
    (chatController as any).channelCatalog.channels = channels;
    const opened: string[] = [];
    const ctx = {
      createPaneFromTemplate(templateId: string, options?: { arg?: string }) {
        opened.push(`${templateId}:${options?.arg ?? ""}`);
      },
    } as any;
    const results = buildWhoCommandResults(ctx, "@bob");
    expect(results[0]?.label).toBe("@bob");
    expect(results[0]?.detail).toContain("Bob");
    results[0]?.execute();
    expect(opened).toEqual(["new-chat-pane:dm:bob"]);
  });

  test("does not list or open people without a public profile", () => {
    (chatController as any).channelCatalog.channels = [
      ...channels,
      {
        id: "dm:cara",
        name: "@cara",
        kind: "direct",
        created_at: "2026-07-03T09:32:00.000Z",
        dmUser: privateCara,
      },
    ];
    const ctx = {
      createPaneFromTemplate() {},
    } as any;
    expect(buildWhoCommandResults(ctx, "cara").every((result) => result.disabled || result.id !== "who:u3")).toBe(true);
    expect(buildWhoCommandResults(ctx, "cara").some((result) => result.label === "@cara" && !result.disabled)).toBe(false);
    expect(buildWhoCommandResults(ctx, "bob").map((result) => result.label)).toEqual(["@bob"]);
  });
});

describe("openChatProfileFromCommand", () => {
  test("opens chat and requests the public profile", () => {
    (chatController as any).channelCatalog.channels = channels;
    const opened: Array<{ templateId: string; options?: { arg?: string } }> = [];
    openChatProfileFromCommand({
      createPaneFromTemplate(templateId, options) {
        opened.push({ templateId, options });
      },
    }, bob);
    expect(opened).toEqual([{ templateId: "new-chat-pane", options: { arg: "dm:bob" } }]);
  });
});
