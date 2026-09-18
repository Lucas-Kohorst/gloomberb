import { describe, expect, test } from "bun:test";
import { getDesktopBackendPlugins } from "./catalog-backend";
import { getLoadablePlugins } from "./catalog";

describe("desktop backend plugin catalog", () => {
  test("keeps plugin identity and order aligned without renderer-only contributions", () => {
    const backendPlugins = getDesktopBackendPlugins();

    expect(backendPlugins.map((plugin) => plugin.id)).toEqual(
      getLoadablePlugins().map((plugin) => plugin.id),
    );

    for (const pluginId of ["ticker-research", "prediction-markets"]) {
      const plugin = backendPlugins.find((candidate) => candidate.id === pluginId);
      expect(plugin).toBeDefined();
      expect(plugin?.panes).toBeUndefined();
      expect(plugin?.paneTemplates).toBeUndefined();
      expect(plugin?.slots).toBeUndefined();
    }
  });

  test("registers Adjacent Cloud as a data plugin with AI Benchmarks and OWID", () => {
    const plugins = getLoadablePlugins();
    const adjacent = plugins.find((plugin) => plugin.id === "adjacent");
    const cloud = plugins.find((plugin) => plugin.id === "gloomberb-cloud");

    // Polls is first-party (VoteHub). Weather stays in gloomberb-plugins.
    expect(plugins.some((plugin) => plugin.id === "polls")).toBe(true);
    expect(plugins.some((plugin) => plugin.id === "congress-trades")).toBe(true);
    expect(plugins.some((plugin) => plugin.id === "federal-register")).toBe(true);
    expect(plugins.some((plugin) => plugin.id === "ofac-sanctions")).toBe(true);
    expect(plugins.some((plugin) => plugin.id === "usaspending")).toBe(true);
    expect(plugins.some((plugin) => plugin.id === "llm-stats")).toBe(false);
    expect(plugins.some((plugin) => plugin.id === "weather")).toBe(false);
    expect(adjacent?.name).toBe("Adjacent Cloud");
    expect(adjacent?.toggleable).toBe(true);
    expect(adjacent?.panes?.map((pane) => pane.id)).toEqual([
      "adjacent",
      "llm-stats",
      "owid",
    ]);
    expect(cloud?.panes?.some((pane) => pane.id.startsWith("adjacent-"))).toBe(false);
  });
});
