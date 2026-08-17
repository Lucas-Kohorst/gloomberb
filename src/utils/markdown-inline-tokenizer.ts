export interface MarkdownInlineStyle {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
}

interface MarkdownInlineTextToken {
  kind: "text";
  value: string;
  style?: MarkdownInlineStyle;
}

interface MarkdownInlineLinkToken {
  kind: "link";
  value: string;
  url: string;
}

export type MarkdownInlineToken = MarkdownInlineTextToken | MarkdownInlineLinkToken;

// Order matters: `**` must be tried before `*`, and links before everything else.
// Underscore emphasis requires non-word boundaries so snake_case survives intact.
const INLINE_RE = new RegExp([
  /\[(?<linkText>[^\]\n]+)\]\((?<linkHref>[^)\s\n]+)\)/.source,
  /\*\*(?<bold>[^*\n]+)\*\*/.source,
  /(?<!\w)__(?<boldAlt>[^_\n]+)__(?!\w)/.source,
  /(?<!\*)\*(?!\*)(?<italic>[^*\n]+)\*(?!\*)/.source,
  /(?<!\w)_(?<italicAlt>[^_\n]+)_(?!\w)/.source,
  /`(?<code>[^`\n]+)`/.source,
  /~~(?<strike>[^~\n]+)~~/.source,
].join("|"), "g");

const SAFE_LINK_RE = /^(?:https?:\/\/|mailto:|www\.)/i;

function normalizeMarkdownUrl(href: string): string | null {
  if (!SAFE_LINK_RE.test(href)) return null;
  return /^www\./i.test(href) ? `https://${href}` : href;
}

/**
 * Parses the inline markdown people actually type in chat. Emphasis markers are
 * dropped from the emitted value so downstream wrapping measures visible width.
 */
export function tokenizeMarkdownInline(text: string): MarkdownInlineToken[] {
  const tokens: MarkdownInlineToken[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  const pushText = (value: string, style?: MarkdownInlineStyle) => {
    if (value) tokens.push(style ? { kind: "text", value, style } : { kind: "text", value });
  };

  INLINE_RE.lastIndex = 0;
  while ((match = INLINE_RE.exec(text)) !== null) {
    const groups = match.groups ?? {};
    if (match.index > cursor) pushText(text.slice(cursor, match.index));
    cursor = match.index + match[0].length;

    if (groups.linkText != null) {
      const url = normalizeMarkdownUrl(groups.linkHref ?? "");
      if (url) {
        tokens.push({ kind: "link", value: groups.linkText, url });
      } else {
        pushText(match[0]);
      }
      continue;
    }

    const bold = groups.bold ?? groups.boldAlt;
    if (bold != null) {
      pushText(bold, { bold: true });
      continue;
    }
    const italic = groups.italic ?? groups.italicAlt;
    if (italic != null) {
      pushText(italic, { italic: true });
      continue;
    }
    if (groups.code != null) {
      pushText(groups.code, { code: true });
      continue;
    }
    if (groups.strike != null) {
      pushText(groups.strike, { strike: true });
    }
  }

  if (cursor < text.length) pushText(text.slice(cursor));
  return tokens;
}
