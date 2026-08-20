import { describe, expect, test } from "bun:test";
import { macroPlugin, marketOverviewPlugin } from "./composite-plugins";

function templatePrefixes(plugin: { paneTemplates?: Array<{ shortcut?: { prefix: string } }> }): string[] {
  return (plugin.paneTemplates ?? [])
    .map((template) => template.shortcut?.prefix)
    .filter((prefix): prefix is string => !!prefix);
}

describe("composed market and macro pane shortcuts", () => {
  test("registers the ported command-bar prefixes", () => {
    const prefixes = [
      ...templatePrefixes(macroPlugin),
      ...templatePrefixes(marketOverviewPlugin),
    ];
    expect(prefixes).toEqual(expect.arrayContaining(["AUCT", "CRD", "BOND", "VIX", "HILO", "FLOW"]));
    expect(prefixes).not.toContain("WX");
    expect(prefixes).not.toContain("POLL");
  });
});
