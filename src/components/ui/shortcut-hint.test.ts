import { describe, expect, test } from "bun:test";
import {
  getShortcutHintWidth,
  normalizeShortcutHint,
  shortcutHintDisplayText,
} from "./shortcut-hint-format";

describe("normalizeShortcutHint", () => {
  test("keeps remainder labels like [s]eries and [r]efresh", () => {
    expect(shortcutHintDisplayText("s", "eries")).toBe("[s]eries");
    expect(shortcutHintDisplayText("r", "efresh")).toBe("[r]efresh");
    expect(shortcutHintDisplayText("r", "refresh")).toBe("[r]efresh");
  });

  test("spaces keys that are not a letter prefix of the action word", () => {
    expect(shortcutHintDisplayText("y", "share")).toBe("[y] share");
    expect(shortcutHintDisplayText("y", " share")).toBe("[y] share");
    expect(shortcutHintDisplayText("Shift+R", "reload")).toBe("[Shift+R] reload");
    expect(shortcutHintDisplayText("1-8", "range")).toBe("[1-8] range");
    expect(shortcutHintDisplayText("/", "search")).toBe("[/] search");
    expect(shortcutHintDisplayText("Enter", "save")).toBe("[Enter] save");
    expect(shortcutHintDisplayText("Enter", "install")).toBe("[Enter] install");
    expect(shortcutHintDisplayText("Esc", "cancel")).toBe("[Esc] cancel");
    expect(shortcutHintDisplayText("x", "remove")).toBe("[x] remove");
  });

  test("keeps remainder phrases that continue the key letter", () => {
    expect(shortcutHintDisplayText("t", "oggle range")).toBe("[t]oggle range");
    expect(shortcutHintDisplayText("p", "op out")).toBe("[p]op out");
  });

  test("counts display width from the normalized string", () => {
    expect(getShortcutHintWidth("s", "eries")).toBe("[s]eries".length);
    expect(getShortcutHintWidth("y", "share", " ")).toBe(" [y] share".length);
    expect(normalizeShortcutHint("y", " share")).toEqual({
      hotkey: "y",
      label: "share",
      glue: " ",
    });
  });
});
