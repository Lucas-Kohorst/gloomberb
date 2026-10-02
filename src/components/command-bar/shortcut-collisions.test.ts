import { describe, expect, test } from "bun:test";
import { loadBuiltinRegistrySnapshot } from "../../test-support/builtin-registry";
import { commands, getCommandPrefixes } from "./commands/registry";
import { getPaneShortcutPrefixes } from "./pane-templates/items";

/**
 * Prefixes where a command and a pane template intentionally open the same
 * pane. The command wins resolution and the bar hides the template row; the
 * value is the pane id the template must keep opening.
 */
const SAME_TARGET_PREFIXES: Record<string, string> = {
  HELP: "help",
  TEAM: "team",
  TWIT: "twitter-feed",
};

interface Claim {
  source: "command" | "plugin-command" | "pane-template";
  id: string;
  paneId?: string;
}

const snapshot = loadBuiltinRegistrySnapshot();

function collectClaims(): Map<string, Claim[]> {
  const claims = new Map<string, Claim[]>();
  const add = (prefix: string, claim: Claim) => {
    const key = prefix.trim().toUpperCase();
    if (!key) return;
    claims.set(key, [...(claims.get(key) ?? []), claim]);
  };
  for (const command of commands) {
    for (const prefix of getCommandPrefixes(command)) add(prefix, { source: "command", id: command.id });
  }
  for (const command of snapshot.commands) {
    for (const prefix of [command.shortcut ?? "", ...(command.shortcutAliases ?? [])]) {
      add(prefix, { source: "plugin-command", id: command.id });
    }
  }
  for (const template of snapshot.paneTemplates) {
    for (const prefix of getPaneShortcutPrefixes(template)) {
      add(prefix, { source: "pane-template", id: template.id, paneId: template.paneId });
    }
  }
  return claims;
}

describe("command-bar shortcut collisions", () => {
  test("no two commands or pane templates claim the same prefix or alias", () => {
    const collisions = [...collectClaims()]
      .filter(([prefix, claims]) => claims.length > 1 && !(prefix in SAME_TARGET_PREFIXES))
      .map(([prefix, claims]) => `${prefix}: ${claims.map((claim) => `${claim.source}:${claim.id}`).join(", ")}`);
    expect(collisions, "Give each pane/command its own prefix, or list a same-target pair in SAME_TARGET_PREFIXES.").toEqual([]);
  });

  test("same-target prefixes pair one command with one template for the named pane", () => {
    const claims = collectClaims();
    for (const [prefix, paneId] of Object.entries(SAME_TARGET_PREFIXES)) {
      const owners = claims.get(prefix) ?? [];
      const templates = owners.filter((claim) => claim.source === "pane-template");
      const commandOwners = owners.filter((claim) => claim.source !== "pane-template");
      expect(templates.map((claim) => claim.paneId), prefix).toEqual([paneId]);
      expect(commandOwners, prefix).toHaveLength(1);
    }
  });
});
