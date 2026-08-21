/**
 * Web/desktop UI typefaces. The terminal renderer ignores these — the emulator
 * owns the TUI font — so this only mutates DOM CSS variables.
 *
 * Default UI is IBM Plex Sans (not Inter/Roboto/Arial/system-ui). Data tables
 * stay on IBM Plex Mono for tabular figures even when the UI face is sans.
 */

export const DEFAULT_FONT_FAMILY = "ibm-plex-sans";

const MONO_STACK = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

export interface FontFamilyOption {
  id: string;
  name: string;
  description: string;
  uiStack: string;
  dataStack: string;
}

export const FONT_FAMILIES: Record<string, FontFamilyOption> = {
  "ibm-plex-sans": {
    id: "ibm-plex-sans",
    name: "IBM Plex Sans",
    description: "UI sans; IBM Plex Mono for tables",
    uiStack: `"IBM Plex Sans", ${MONO_STACK}`,
    dataStack: MONO_STACK,
  },
  "ibm-plex-mono": {
    id: "ibm-plex-mono",
    name: "IBM Plex Mono",
    description: "Monospace UI and data",
    uiStack: MONO_STACK,
    dataStack: MONO_STACK,
  },
};

let appliedFontFamilyId = DEFAULT_FONT_FAMILY;
let appliedToDocument = false;

export function getFontFamilyIds(): string[] {
  return Object.keys(FONT_FAMILIES);
}

export function sanitizeFontFamily(value: unknown): string {
  if (typeof value === "string" && FONT_FAMILIES[value]) return value;
  return DEFAULT_FONT_FAMILY;
}

export function getFontFamily(id: string): FontFamilyOption {
  return FONT_FAMILIES[sanitizeFontFamily(id)]!;
}

export function getFontFamilyId(): string {
  return appliedFontFamilyId;
}

/**
 * Applies the UI/data font stacks. Returns true when the document changed.
 */
export function syncFontFamily(fontFamilyId: unknown): boolean {
  const id = sanitizeFontFamily(fontFamilyId);
  if (id === appliedFontFamilyId && appliedToDocument) return false;

  appliedFontFamilyId = id;
  const option = FONT_FAMILIES[id]!;
  const style = (globalThis as {
    document?: { body?: { style?: { setProperty: (name: string, value: string) => void } } };
  }).document?.body?.style;
  if (!style) return false;

  style.setProperty("--gloom-ui-font", option.uiStack);
  style.setProperty("--gloom-data-font", option.dataStack);
  style.setProperty("font-family", option.uiStack);
  appliedToDocument = true;
  return true;
}

export function resetFontFamilyForTests(): void {
  appliedFontFamilyId = DEFAULT_FONT_FAMILY;
  appliedToDocument = false;
}
