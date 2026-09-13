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

  test("letter keys prefix the action with no space after the bracket", () => {
    expect(shortcutHintDisplayText("s", "hare")).toBe("[s]hare");
    expect(shortcutHintDisplayText("s", "share")).toBe("[s]hare");
    expect(shortcutHintDisplayText("y", "ank")).toBe("[y]ank");
    expect(shortcutHintDisplayText("d", "elete")).toBe("[d]elete");
  });

  test("spaces non-letter keys from the action word", () => {
    expect(shortcutHintDisplayText("Shift+R", "reload")).toBe("[Shift+R] reload");
    expect(shortcutHintDisplayText("1-8", "range")).toBe("[1-8] range");
    expect(shortcutHintDisplayText("/", "search")).toBe("[/] search");
    expect(shortcutHintDisplayText("Enter", "save")).toBe("[Enter] save");
    expect(shortcutHintDisplayText("Enter", "install")).toBe("[Enter] install");
    expect(shortcutHintDisplayText("Esc", "cancel")).toBe("[Esc] cancel");
  });

  test("keeps remainder phrases that continue the key letter", () => {
    expect(shortcutHintDisplayText("t", "oggle range")).toBe("[t]oggle range");
    expect(shortcutHintDisplayText("p", "op out")).toBe("[p]op out");
  });

  test("counts display width from the normalized string", () => {
    expect(getShortcutHintWidth("s", "eries")).toBe("[s]eries".length);
    expect(getShortcutHintWidth("s", "hare", " ")).toBe(" [s]hare".length);
    expect(normalizeShortcutHint("s", "share")).toEqual({
      hotkey: "s",
      label: "hare",
      glue: "",
    });
  });
});
