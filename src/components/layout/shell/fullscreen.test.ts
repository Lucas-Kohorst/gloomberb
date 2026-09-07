import { describe, expect, test } from "bun:test";
import type { LayoutConfig } from "../../../types/config";
import {
  captureFullscreenHiddenDockedIds,
  retainHiddenDockedIds,
} from "./fullscreen";

function layoutWith(ids: { docked: string[]; floating?: string[] }): LayoutConfig {
  return {
    dockRoot: ids.docked.length === 1
      ? { kind: "pane", instanceId: ids.docked[0]! }
      : {
        kind: "split",
        axis: "horizontal",
        ratio: 0.5,
        first: { kind: "pane", instanceId: ids.docked[0]! },
        second: { kind: "pane", instanceId: ids.docked[1]! },
      },
    instances: [...ids.docked, ...(ids.floating ?? [])].map((instanceId) => ({
      instanceId,
      paneId: instanceId.split(":")[0]!,
      binding: { kind: "none" as const },
    })),
    floating: (ids.floating ?? []).map((instanceId, index) => ({
      instanceId,
      x: 8,
      y: 2,
      width: 32,
      height: 10,
      zIndex: 50 + index,
    })),
    detached: [],
  };
}

describe("fullscreen overlay helpers", () => {
  test("hides the original docked siblings and keeps later docks visible", () => {
    const source = layoutWith({ docked: ["portfolio-list:main", "news:main"] });
    const hidden = captureFullscreenHiddenDockedIds(source, "portfolio-list:main");
    expect(hidden).toEqual(["news:main"]);

    const afterFloat = layoutWith({ docked: ["portfolio-list:main"], floating: ["news:main"] });
    expect(retainHiddenDockedIds(hidden, afterFloat)).toEqual([]);
  });
});
