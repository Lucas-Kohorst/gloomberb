import type { TextareaRenderable } from "../../../../ui";

const clampCursorOffset = (offset: number, draft: string) => Math.max(0, Math.min(offset, draft.length));

export function getComposerCursorOffset(
  textarea: TextareaRenderable | null | undefined,
  draft: string,
): number {
  const visual = textarea?.visualCursor?.offset;
  const stored = textarea?.cursorOffset;
  const hasVisual = typeof visual === "number";
  const hasStored = typeof stored === "number";
  // OpenTUI's editorView cursor can lag at 0 after an insert while the
  // textarea cursorOffset already reflects the caret after the typed text.
  // Preferring that stale 0 makes `@` look like it is not a mention trigger,
  // so Enter sends "@" instead of inserting the selected username.
  let offset: number;
  if (hasVisual && hasStored) {
    offset = visual === 0 && stored > 0 ? stored : visual;
  } else if (hasVisual) {
    offset = visual;
  } else if (hasStored) {
    offset = stored;
  } else {
    offset = draft.length;
  }
  return clampCursorOffset(offset, draft);
}

export function moveComposerCursorToOffset(
  textarea: TextareaRenderable,
  draft: string,
  offset: number,
): void {
  const nextOffset = clampCursorOffset(offset, draft);
  const editBuffer = textarea.editBuffer as typeof textarea.editBuffer & {
    setCursorByOffset?: (offset: number) => void;
  };
  // `setText` resets the caret. OpenTUI keeps an editBuffer cursor and a visual
  // editorView cursor; setting only one leaves typing at offset 0 (` fixtypo`).
  if (typeof editBuffer.setCursorByOffset === "function") {
    editBuffer.setCursorByOffset(nextOffset);
  }
  if (typeof textarea.setCursorOffset === "function") {
    textarea.setCursorOffset(nextOffset);
    return;
  }
  try {
    textarea.cursorOffset = nextOffset;
  } catch {
    // Some host renderers expose cursorOffset as read-only.
  }
}
