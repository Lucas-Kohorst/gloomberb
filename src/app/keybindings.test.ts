import { describe, expect, test } from "bun:test";
import {
  findKeybindingConflict,
  resolveKeybindings,
  setKeybinding,
} from "./keybindings";
import type { AppConfig } from "../types/config";
import type { KeyboardShortcut } from "../types/plugin";

const config = (keybindings: AppConfig["keybindings"] = {}): AppConfig => (
  { keybindings } as AppConfig
);

const pluginShortcut: KeyboardShortcut = {
  id: "example.export",
  key: "e",
  ctrl: true,
  description: "Export report",
  execute: () => {},
};

describe("keybindings", () => {
  test("uses a user override over a registered default", () => {
    const resolved = resolveKeybindings(config({
      "example.export": { key: "x", alt: true },
    }), [pluginShortcut]);

    expect(resolved.find((entry) => entry.id === "example.export")).toMatchObject({
      key: "x",
      alt: true,
    });
  });

  test("rejects registered and platform-reserved conflicts", () => {
    expect(findKeybindingConflict(
      "global.quit",
      { key: "e", ctrl: true },
      config(),
      [pluginShortcut],
    )).toBe("Ctrl+E is already assigned to Export report.");

    const result = setKeybinding(
      config(),
      "global.quit",
      { key: "1", ctrl: true },
      [pluginShortcut],
    );
    expect(result.error).toBe("Ctrl+1 through Ctrl+9 are reserved for switching layouts.");
  });
});
