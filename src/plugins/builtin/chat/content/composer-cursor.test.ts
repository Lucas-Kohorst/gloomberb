import { describe, expect, test } from "bun:test";
import { getComposerCursorOffset } from "./composer-cursor";
import type { TextareaRenderable } from "../../../../ui";

function textarea(offsets: { visual?: number; stored?: number }): TextareaRenderable {
  return {
    visualCursor: offsets.visual == null ? undefined : { offset: offsets.visual },
    cursorOffset: offsets.stored,
  } as TextareaRenderable;
}

describe("getComposerCursorOffset", () => {
  test("prefers a stored caret over a lagged visual 0 after insert", () => {
    expect(getComposerCursorOffset(textarea({ visual: 0, stored: 1 }), "@")).toBe(1);
  });

  test("keeps a real start-of-text caret when both cursors are 0", () => {
    expect(getComposerCursorOffset(textarea({ visual: 0, stored: 0 }), "@bravo")).toBe(0);
  });
});
