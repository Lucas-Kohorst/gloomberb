import { t, tf } from "../../i18n";

/** The one loading phrasing: "Loading..." with three dots, never the ellipsis glyph. */
export function loadingText(_thing?: string): string {
  return t("Loading...");
}

/** The one failure phrasing: "{thing} unavailable." */
export function unavailableText(thing: string): string {
  return tf("{thing} unavailable.", { thing });
}
