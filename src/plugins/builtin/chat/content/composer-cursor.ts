import type { TextareaRenderable } from "../../../../ui";

const clampCursorOffset = (offset: number, draft: string) => Math.max(0, Math.min(offset, draft.length));

function numericOffset(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function logicalCursorOffset(textarea: TextareaRenderable | null | undefined): number | undefined {
  const logical = numericOffset((textarea as TextareaRenderable & {
    logicalCursor?: { offset?: number };
  } | null | undefined)?.logicalCursor?.offset);
  if (logical != null) return logical;
  const getCursorPosition = textarea?.editBuffer
    && "getCursorPosition" in textarea.editBuffer
    ? (textarea.editBuffer as { getCursorPosition?: () => { offset?: number } }).getCursorPosition
    : undefined;
  return numericOffset(getCursorPosition?.()?.offset);
}

export function getComposerCursorOffset(
  textarea: TextareaRenderable | null | undefined,
  draft: string,
): number {
  // OpenTUI's `cursorOffset` getter is the editorView visual caret, which can
  // lag at 0 after an insert. Mentions key off the caret, so that stale 0
  // makes `@` look like it is not a trigger and Enter sends "@".
  const offset = logicalCursorOffset(textarea)
    ?? numericOffset(textarea?.visualCursor?.offset)
    ?? numericOffset(textarea?.cursorOffset)
    ?? draft.length;
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
