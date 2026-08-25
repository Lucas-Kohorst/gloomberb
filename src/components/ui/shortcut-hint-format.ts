/** Full action words that are not a single-letter prefix remainder (`[s]eries`). */
const STANDALONE_HINT_WORDS = new Set([
  "share",
  "reload",
  "range",
  "search",
  "save",
  "cancel",
  "install",
  "remove",
  "edit",
]);

export interface NormalizedShortcutHint {
  hotkey: string;
  /** Text after `]`, without a leading space — glue owns spacing. */
  label: string;
  glue: "" | " ";
}

export function normalizeShortcutHint(hotkey: string, label: string): NormalizedShortcutHint {
  const hadLeadingSpace = /^\s/.test(label);
  const trimmed = label.trim();
  const key = hotkey.trim();
  const singleLetter = /^[a-z]$/i.test(key);

  if (singleLetter && trimmed.toLowerCase().startsWith(key.toLowerCase())) {
    return { hotkey: key, label: trimmed.slice(key.length), glue: "" };
  }
  if (!singleLetter) {
    return { hotkey: key, label: trimmed, glue: trimmed ? " " : "" };
  }
  if (
    !trimmed.includes(" ")
    && (hadLeadingSpace || STANDALONE_HINT_WORDS.has(trimmed.toLowerCase()))
  ) {
    return { hotkey: key, label: trimmed, glue: " " };
  }
  if (hadLeadingSpace) {
    return { hotkey: key, label: trimmed, glue: " " };
  }
  return { hotkey: key, label: trimmed, glue: "" };
}

export function shortcutHintDisplayText(hotkey: string, label: string, prefix = ""): string {
  const hint = normalizeShortcutHint(hotkey, label);
  return `${prefix}[${hint.hotkey}]${hint.glue}${hint.label}`;
}

export function getShortcutHintWidth(hotkey: string, label: string, prefix = ""): number {
  return shortcutHintDisplayText(hotkey, label, prefix).length;
}
