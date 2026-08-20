import { describe, expect, test } from "bun:test";
import {
  isValidConversationCreateArg,
  parseConversationCreateArg,
  parseGroupCreateName,
} from "./channels";

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
