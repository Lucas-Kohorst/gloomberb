import { describe, expect, test } from "bun:test";
import { uiBuiltinPlugins } from "./catalog-ui";

describe("uiBuiltinPlugins", () => {
  test("evaluates without throwing and every plugin has an id", () => {
    expect(uiBuiltinPlugins.length).toBeGreaterThan(0);
    const ids = uiBuiltinPlugins.map((plugin) => plugin.id);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    expect(ids).toContain("news");
    expect(new Set(ids).size).toBe(ids.length);
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
