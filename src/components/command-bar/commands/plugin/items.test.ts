import { describe, expect, test } from "bun:test";
import type { CommandDef } from "../../../../types/plugin";
import { getPluginCommandCategory } from "./items";

describe("getPluginCommandCategory", () => {
  test("uses the command's declared category rather than plugin ownership", () => {
    const command = {
      id: "adjacent-markets-search",
      label: "Search Adjacent Markets",
      description: "Search Adjacent",
      keywords: ["adjacent"],
      category: "data",
      execute: () => {},
    } satisfies CommandDef;

    expect(getPluginCommandCategory(command)).toBe("Data");
  });
});
