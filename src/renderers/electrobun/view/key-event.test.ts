import { describe, expect, test } from "bun:test";
import {
  resolveWebShortcutKeyName,
  shouldConsumeWebAppKeyDown,
  shouldDispatchWebAppKeyDown,
  shouldDispatchWebNativeKeyDown,
} from "./key-event";

function keyEvent(overrides: Record<string, unknown>) {
  return {
    key: "x",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    target: null,
    ...overrides,
  } as never;
}

describe("resolveWebShortcutKeyName", () => {
  test("maps Option+Digit keys to the physical number so Mac option-digit shortcuts match", () => {
    expect(resolveWebShortcutKeyName({ key: "¡", code: "Digit1", altKey: true })).toBe("1");
    expect(resolveWebShortcutKeyName({ key: "™", code: "Digit2", altKey: true })).toBe("2");
    expect(resolveWebShortcutKeyName({ key: "1", code: "Digit1", altKey: true })).toBe("1");
    expect(resolveWebShortcutKeyName({ key: "¡", code: "Digit1", altKey: false })).toBe("¡");
    expect(resolveWebShortcutKeyName({ key: "1", code: "Digit1" })).toBe("1");
  });
});

describe("shouldConsumeWebAppKeyDown", () => {
  test("consumes non-editable app keydowns", () => {
    expect(shouldConsumeWebAppKeyDown(keyEvent({ key: "+" }))).toBe(true);
    expect(shouldConsumeWebAppKeyDown(keyEvent({ key: "ArrowDown", target: { tagName: "DIV" } }))).toBe(true);
  });

  test("preserves native editing and control targets", () => {
    expect(shouldConsumeWebAppKeyDown(keyEvent({ target: { tagName: "INPUT" } }))).toBe(false);
    expect(shouldConsumeWebAppKeyDown(keyEvent({ target: { tagName: "TEXTAREA" } }))).toBe(false);
    expect(shouldConsumeWebAppKeyDown(keyEvent({ target: { tagName: "DIV", isContentEditable: true } }))).toBe(false);
    expect(shouldConsumeWebAppKeyDown(keyEvent({ key: "Enter", target: { tagName: "BUTTON" } }))).toBe(false);
    expect(shouldConsumeWebAppKeyDown(keyEvent({ key: "+", target: { tagName: "BUTTON" } }))).toBe(true);
  });

  test("preserves browser modifier shortcuts unless they are terminal-style ctrl-shift shortcuts", () => {
    expect(shouldConsumeWebAppKeyDown(keyEvent({ key: "c", ctrlKey: true }))).toBe(false);
    expect(shouldConsumeWebAppKeyDown(keyEvent({ key: "c", metaKey: true }))).toBe(false);
    expect(shouldConsumeWebAppKeyDown(keyEvent({ key: "c", ctrlKey: true, shiftKey: true }))).toBe(true);
  });

  test("dispatches Tab to the app so pane cycling can preventDefault, but preserves native Tab in editable controls", () => {
    const root = { tagName: "DIV", getAttribute: (name: string) => name === "id" ? "root" : null };
    const button = { tagName: "BUTTON" };
    const input = { tagName: "INPUT" };

    for (const target of [root, button]) {
      const event = keyEvent({ key: "Tab", target });
      expect(shouldDispatchWebAppKeyDown(event)).toBe(true);
      expect(shouldConsumeWebAppKeyDown(event)).toBe(true);
    }
    // Tab inside editable controls stays native so the user can move within text
    expect(shouldConsumeWebAppKeyDown(keyEvent({ key: "Tab", target: input }))).toBe(false);
    // Modified Tab (Shift+Tab) is also dispatched
    expect(shouldDispatchWebAppKeyDown(keyEvent({ key: "Tab", shiftKey: true, target: button }))).toBe(true);
  });

  test("bypasses app shortcut dispatch for native control activation keys", () => {
    const button = { tagName: "BUTTON" };
    const link = { tagName: "A", getAttribute: (name: string) => name === "href" ? "/details" : null };
    const buttonChild = {
      tagName: "SVG",
      closest: (selector: string) => selector.includes("button") ? button : null,
    };

    for (const key of ["Enter", "Return", " "]) {
      for (const target of [button, buttonChild, link, { tagName: "SUMMARY" }]) {
        expect(shouldDispatchWebAppKeyDown(keyEvent({ key, target }))).toBe(false);
      }
    }

    expect(shouldDispatchWebAppKeyDown(keyEvent({ key: "+", target: button }))).toBe(true);
    expect(shouldDispatchWebAppKeyDown(keyEvent({ key: "Enter", target: { tagName: "A", getAttribute: () => null } }))).toBe(true);
  });

  test("keeps native renderer keypresses out of editable DOM controls", () => {
    const editableTargets = [
      { tagName: "INPUT" },
      { tagName: "TEXTAREA" },
      { tagName: "SELECT" },
      { tagName: "DIV", isContentEditable: true },
      { tagName: "SPAN", closest: (selector: string) => selector.includes("contenteditable") ? {} : null },
    ];

    for (const target of editableTargets) {
      expect(shouldDispatchWebNativeKeyDown(keyEvent({ key: "x", target }))).toBe(false);
      expect(shouldDispatchWebNativeKeyDown(keyEvent({ key: "Enter", target }))).toBe(false);
    }
  });
});
