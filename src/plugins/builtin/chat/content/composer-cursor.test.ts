import { describe, expect, test } from "bun:test";
import { getComposerCursorOffset } from "./composer-cursor";
import type { TextareaRenderable } from "../../../../ui";

function textarea(offsets: { logical?: number; visual?: number; stored?: number }): TextareaRenderable {
  return {
    visualCursor: offsets.visual == null ? undefined : { offset: offsets.visual },
    cursorOffset: offsets.stored,
    logicalCursor: offsets.logical == null ? undefined : { offset: offsets.logical },
  } as TextareaRenderable;
}

describe("getComposerCursorOffset", () => {
  test("uses the edit-buffer logical caret when the visual cursor still lags at 0", () => {
    expect(getComposerCursorOffset(textarea({ logical: 1, visual: 0, stored: 0 }), "@")).toBe(1);
  });

  test("keeps a real start-of-text caret when every cursor is 0", () => {
    expect(getComposerCursorOffset(textarea({ logical: 0, visual: 0, stored: 0 }), "@bravo")).toBe(0);
  });
});
