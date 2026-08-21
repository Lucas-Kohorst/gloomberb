/**
 * Web/desktop UI typeface. The terminal renderer ignores this — the emulator
 * owns the TUI font — so this only mutates DOM CSS variables.
 *
 * Adjacent theming keeps the original system monospace stack. Font family is
 * not user-configurable; stale ibm-plex-* ids from older configs remap here.
 */

export const DEFAULT_FONT_FAMILY = "system-mono";

export const SYSTEM_MONO_STACK =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

export interface FontFamilyOption {
  id: string;
  name: string;
  description: string;
  uiStack: string;
  dataStack: string;
}

const SYSTEM_MONO: FontFamilyOption = {
  id: DEFAULT_FONT_FAMILY,
  name: "System Mono",
  description: "Original terminal stack",
  uiStack: SYSTEM_MONO_STACK,
  dataStack: SYSTEM_MONO_STACK,
};

let appliedFontFamilyId = DEFAULT_FONT_FAMILY;
let appliedToDocument = false;

export function sanitizeFontFamily(_value: unknown): string {
  return DEFAULT_FONT_FAMILY;
}

export function getFontFamily(_id?: string): FontFamilyOption {
  return SYSTEM_MONO;
}

export function getFontFamilyId(): string {
  return appliedFontFamilyId;
}

/**
 * Applies the UI/data font stacks. Returns true when the document changed.
 */
export function syncFontFamily(_fontFamilyId?: unknown): boolean {
  const id = DEFAULT_FONT_FAMILY;
  if (id === appliedFontFamilyId && appliedToDocument) return false;

  appliedFontFamilyId = id;
  const style = (globalThis as {
    document?: { body?: { style?: { setProperty: (name: string, value: string) => void } } };
  }).document?.body?.style;
  if (!style) return false;

  style.setProperty("--gloom-ui-font", SYSTEM_MONO.uiStack);
  style.setProperty("--gloom-data-font", SYSTEM_MONO.dataStack);
  style.setProperty("font-family", SYSTEM_MONO.uiStack);
  appliedToDocument = true;
  return true;
}

export function resetFontFamilyForTests(): void {
  appliedFontFamilyId = DEFAULT_FONT_FAMILY;
  appliedToDocument = false;
}
