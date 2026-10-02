import { describe, expect, test } from "bun:test";
import { loadBuiltinRegistrySnapshot, snapshotRegistry } from "../../../test-support/builtin-registry";
import { ESSENTIAL_COMMAND_PREFIXES, resolveEssentialCommands } from "./shortcut-model";

const snapshot = loadBuiltinRegistrySnapshot();

describe("Help essential commands", () => {
  test("every curated prefix still resolves to a registered command or pane", () => {
    const entries = resolveEssentialCommands(snapshotRegistry(snapshot));
    expect(entries.map((entry) => entry.prefixes[0])).toEqual([...ESSENTIAL_COMMAND_PREFIXES]);
    for (const entry of entries) {
      expect(entry.label.length, entry.id).toBeGreaterThan(0);
      expect(entry.description.length, entry.id).toBeGreaterThan(0);
    }
  });

  test("uses the entry the command bar runs and keeps an argument slot for prefixes that take one", () => {
    const byPrefix = new Map(resolveEssentialCommands(snapshotRegistry(snapshot)).map((entry) => [entry.prefixes[0], entry]));
    expect(byPrefix.get("DES")).toMatchObject({ id: "core:security-description", prefixes: ["DES", "T"], query: "DES " });
    expect(byPrefix.get("TEAM")?.id).toBe("plugin-command:team");
    expect(byPrefix.get("HELP")).toMatchObject({ id: "core:help", query: "HELP" });
    expect(byPrefix.get("N")).toMatchObject({ id: "pane-template:news-feed-pane", query: "N" });
  });

  test("drops entries owned by a disabled plugin", () => {
    const pluginId = snapshot.paneTemplates.find((template) => template.id === "news-feed-pane")?.pluginId;
    expect(pluginId).toBeTruthy();
    const entries = resolveEssentialCommands(snapshotRegistry(snapshot, [pluginId!]));
    expect(entries.some((entry) => entry.prefixes[0] === "N")).toBe(false);
  });
});
