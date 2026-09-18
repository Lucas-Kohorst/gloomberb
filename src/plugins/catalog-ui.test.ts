import { describe, expect, test } from "bun:test";
import type { GloomPlugin } from "../types/plugin";
import { getRendererBuiltinPlugins, getRendererPlugins, nativeUiPlugins, uiBuiltinPlugins } from "./catalog-ui";

describe("uiBuiltinPlugins", () => {
  test("evaluates without throwing and every plugin has an id", () => {
    expect(uiBuiltinPlugins.length).toBeGreaterThan(0);
    const ids = uiBuiltinPlugins.map((plugin) => plugin.id);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    expect(ids).toContain("news");
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("ships Prediction Markets in native Electrobun/TUI, not hosted web builtins", () => {
    expect(uiBuiltinPlugins.map((plugin) => plugin.id)).not.toContain("prediction-markets");
    expect(getRendererBuiltinPlugins().map((plugin) => plugin.id)).not.toContain("prediction-markets");
    expect(nativeUiPlugins.map((plugin) => plugin.id)).toContain("prediction-markets");
    expect(getRendererPlugins().map((plugin) => plugin.id)).toContain("prediction-markets");
  });

  test("ignores an extracted prediction-markets copy so desktop:build is the pane", () => {
    const plugins = getRendererPlugins([{
      plugin: { id: "prediction-markets", name: "Stale PM", version: "0.0.1" } as GloomPlugin,
      path: "/tmp/stale-prediction-markets",
    }]);
    const matches = plugins.filter((plugin) => plugin.id === "prediction-markets");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.name).toBe("Prediction Markets");
  });

  test("does not register the same pane id on two plugins", () => {
    const owners = new Map<string, string>();
    const duplicates: string[] = [];
    for (const plugin of uiBuiltinPlugins) {
      for (const pane of plugin.panes ?? []) {
        const previous = owners.get(pane.id);
        if (previous && previous !== plugin.id) {
          duplicates.push(`${pane.id} (${previous} and ${plugin.id})`);
        } else if (!previous) {
          owners.set(pane.id, plugin.id);
        }
      }
    }
    expect(duplicates).toEqual([]);
  });
});
