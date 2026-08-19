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

  test("registers Adjacent as its own plugin instead of a Gloom Cloud module", () => {
    const plugins = getLoadablePlugins();
    const adjacent = plugins.find((plugin) => plugin.id === "adjacent");
    const cloud = plugins.find((plugin) => plugin.id === "gloomberb-cloud");

    expect(adjacent?.name).toBe("Adjacent");
    expect(adjacent?.toggleable).toBe(true);
    expect(adjacent?.panes?.map((pane) => pane.id)).toEqual(["adjacent-indices", "adjacent-rates"]);
    expect(cloud?.panes?.some((pane) => pane.id.startsWith("adjacent-"))).toBe(false);
  });
});
