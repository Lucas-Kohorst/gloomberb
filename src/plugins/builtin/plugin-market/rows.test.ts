import { describe, expect, test } from "bun:test";
import {
  applyPluginToggle,
  communityResultToRow,
  isCommunityResultInstalled,
  mergeMarketplaceRows,
  pluginRowMatchesQuery,
} from "./rows";
import type { PluginRow, PluginSearchResult } from "./types";

function local(overrides: Partial<PluginRow> & Pick<PluginRow, "id" | "name">): PluginRow {
  return {
    description: "",
    version: "1.0.0",
    enabled: true,
    toggleable: true,
    source: "built-in",
    ...overrides,
  };
}

function community(overrides: Partial<PluginSearchResult> & Pick<PluginSearchResult, "fullName">): PluginSearchResult {
  return {
    id: 1,
    description: "A gloomberb plugin",
    stars: 12,
    url: `https://github.com/${overrides.fullName}`,
    owner: overrides.fullName.split("/")[0] ?? "user",
    updatedAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

describe("plugin marketplace rows", () => {
  test("filters installed plugins by name, id, and description", () => {
    const notes = local({ id: "notes", name: "Notes", description: "Quick notes" });
    const chat = local({ id: "chat", name: "Chat", description: "Cloud chat" });
    expect(pluginRowMatchesQuery(notes, "quick")).toBe(true);
    expect(pluginRowMatchesQuery(chat, "notes")).toBe(false);
    expect(mergeMarketplaceRows([notes, chat], [], "note").map((row) => row.id)).toEqual(["notes"]);
  });

  test("merges GitHub results that are not already installed", () => {
    const installed = local({ id: "alpha", name: "Alpha", dirName: "alpha", source: "external" });
    const already = community({ id: 11, fullName: "someone/alpha" });
    const fresh = community({ id: 12, fullName: "someone/beta", description: "New pane" });
    const merged = mergeMarketplaceRows([installed], [already, fresh], "a");
    expect(merged.map((row) => row.id)).toEqual(["alpha", "github:someone/beta"]);
    expect(isCommunityResultInstalled(already, [installed])).toBe(true);
    expect(communityResultToRow(fresh).source).toBe("github");
    expect(communityResultToRow(fresh).toggleable).toBe(false);
  });

  test("empty search keeps installed plugins and skips GitHub extras", () => {
    const notes = local({ id: "notes", name: "Notes" });
    const extra = community({ fullName: "someone/beta" });
    expect(mergeMarketplaceRows([notes], [extra], "").map((row) => row.id)).toEqual(["notes"]);
  });

  test("toggle wiring skips github rows and updates disabled ids", () => {
    const notes = local({ id: "notes", name: "Notes", enabled: true, toggleable: true });
    const github = communityResultToRow(community({ fullName: "someone/beta" }));
    expect(applyPluginToggle(github, [])).toBeNull();
    expect(applyPluginToggle(notes, [])).toEqual(["notes"]);
    expect(applyPluginToggle({ ...notes, enabled: false }, ["notes"])).toEqual([]);
  });
});
