import { describe, expect, test } from "bun:test";
import { createDefaultConfig } from "../../../types/config";
import {
  buildDmCommandResults,
  isValidConversationCreateArg,
  parseConversationCreateArg,
  parseGroupCreateName,
} from "./channels";
import { chatController } from "./controller";
import { installServerChannels } from "./test-harness";

describe("named group create args", () => {
  test("treats leftover tokens as a group name when two or more users are present", () => {
    expect(parseGroupCreateName("VistaDex trading @alice @bob")).toBe("VistaDex trading");
    expect(parseGroupCreateName("@alice @bob VistaDex trading")).toBe("VistaDex trading");
    expect(parseConversationCreateArg("VistaDex trading @alice @bob")).toEqual({
      usernames: ["alice", "bob"],
      name: "VistaDex trading",
    });
    expect(parseGroupCreateName("@alice @bob")).toBeUndefined();
    expect(parseGroupCreateName("desk @alice")).toBeUndefined();
  });

  test("accepts named group create args and rejects named DMs", () => {
    expect(isValidConversationCreateArg("@alice")).toBe(true);
    expect(isValidConversationCreateArg("@alice @bob")).toBe(true);
    expect(isValidConversationCreateArg("VistaDex trading @alice @bob")).toBe(true);
    expect(isValidConversationCreateArg("desk @alice")).toBe(true);
    expect(isValidConversationCreateArg("hello! @alice")).toBe(false);
    expect(isValidConversationCreateArg("not a user")).toBe(false);
  });
});

describe("DM command results", () => {
  test("bare DM opens the default chat pane instead of a disabled empty row", () => {
    chatController.reset(true);
    installServerChannels(chatController, []);
    const created: { templateId: string; arg: string }[] = [];
    const ctx = {
      getConfig: () => createDefaultConfig("/tmp/gloomberb-dm-test"),
      createPaneFromTemplate: (templateId: string, options?: { arg?: string }) => {
        created.push({ templateId, arg: options?.arg ?? "" });
      },
    } as any;

    const results = buildDmCommandResults(ctx, "");

    expect(results).toHaveLength(1);
    expect(results[0]!.disabled).toBe(false);
    results[0]!.execute?.();
    expect(created).toEqual([{ templateId: "new-chat-pane", arg: "everyone" }]);
  });

  test("bare DM lists existing conversations below the open-chat row", () => {
    chatController.reset(true);
    installServerChannels(chatController, [
      { id: "dm:alice", name: "alice", kind: "direct", created_at: "2026-08-22T00:00:00.000Z" },
    ]);
    const created: { templateId: string; arg: string }[] = [];
    const ctx = {
      getConfig: () => createDefaultConfig("/tmp/gloomberb-dm-test"),
      createPaneFromTemplate: (templateId: string, options?: { arg?: string }) => {
        created.push({ templateId, arg: options?.arg ?? "" });
      },
    } as any;

    const results = buildDmCommandResults(ctx, "");

    expect(results).toHaveLength(2);
    expect(results[0]!.id).toBe("open-chat");
    expect(results[0]!.disabled).toBe(false);
    expect(results[1]!.id).toBe("channel:dm:alice");
  });
});
