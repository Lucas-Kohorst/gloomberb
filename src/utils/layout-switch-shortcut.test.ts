import { describe, expect, test } from "bun:test";
import {
  formatLayoutSwitchShortcutHint,
  isLayoutSwitchShortcut,
  layoutSwitchUsesOption,
} from "./layout-switch-shortcut";

describe("layout switch shortcuts", () => {
  test("desktop-web and native chrome use Option, the terminal keeps Ctrl", () => {
    expect(layoutSwitchUsesOption({ kind: "desktop-web" })).toBe(true);
    expect(layoutSwitchUsesOption({ nativePaneChrome: true })).toBe(true);
    expect(layoutSwitchUsesOption({ kind: "opentui" })).toBe(false);
    expect(layoutSwitchUsesOption({})).toBe(false);
  });

  test("labels Option shortcuts as OPT N on desktop and ^N in the terminal", () => {
    expect(formatLayoutSwitchShortcutHint(1, true)).toBe("OPT 1");
    expect(formatLayoutSwitchShortcutHint(2, true)).toBe("OPT 2");
    expect(formatLayoutSwitchShortcutHint(3, true)).toBe("OPT 3");
    expect(formatLayoutSwitchShortcutHint(1, false)).toBe("^1");
  });

  test("desktop Option+number matches and Command/Ctrl+number do not", () => {
    expect(isLayoutSwitchShortcut({ name: "1", alt: true }, true)).toBe(true);
    expect(isLayoutSwitchShortcut({ name: "2", option: true }, true)).toBe(true);
    expect(isLayoutSwitchShortcut({ name: "1", super: true }, true)).toBe(false);
    expect(isLayoutSwitchShortcut({ name: "1", meta: true }, true)).toBe(false);
    expect(isLayoutSwitchShortcut({ name: "1", ctrl: true }, true)).toBe(false);
    expect(isLayoutSwitchShortcut({ name: "1", alt: true, super: true }, true)).toBe(false);
  });

  test("terminal Ctrl/Command+number matches and Option+number does not", () => {
    expect(isLayoutSwitchShortcut({ name: "2", ctrl: true }, false)).toBe(true);
    expect(isLayoutSwitchShortcut({ name: "2", super: true }, false)).toBe(true);
    expect(isLayoutSwitchShortcut({ name: "2", meta: true }, false)).toBe(true);
    expect(isLayoutSwitchShortcut({ name: "2", alt: true }, false)).toBe(false);
  });
});
