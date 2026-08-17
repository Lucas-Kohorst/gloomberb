import { tokenizeInlineLinks } from "./link-tokenizer";
import {
  tokenizeMarkdownInline,
  type MarkdownInlineStyle,
} from "./markdown-inline-tokenizer";

interface InlineContentTextToken {
  kind: "text";
  value: string;
  style?: MarkdownInlineStyle;
}

interface InlineContentLinkToken {
  kind: "link";
  value: string;
  url: string;
}

interface InlineContentTickerToken {
  kind: "ticker";
  value: string;
  symbol: string;
}

interface InlineContentUsernameToken {
  kind: "username";
  value: string;
  username: string;
}

export type InlineContentToken =
  | InlineContentTextToken
  | InlineContentLinkToken
  | InlineContentTickerToken
  | InlineContentUsernameToken;

const INLINE_SYMBOL_TOKEN_RE = /\$[A-Z][A-Z0-9.-]{0,9}|@[A-Za-z][A-Za-z0-9_]{2,29}/g;
const SYMBOL_CHAR_RE = /[A-Za-z0-9.-]/;
const USERNAME_CHAR_RE = /[A-Za-z0-9_]/;

function trimTrailingTickerPunctuation(value: string): string {
  let trimmed = value;
  while (trimmed.length > 2 && /[.-]$/.test(trimmed)) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed;
}

function isValidTickerBoundary(text: string, start: number, end: number): boolean {
  const prev = start > 0 ? text[start - 1] ?? "" : "";
  const next = end < text.length ? text[end] ?? "" : "";
  return !SYMBOL_CHAR_RE.test(prev) && !SYMBOL_CHAR_RE.test(next);
}

function isValidUsernameBoundary(text: string, start: number, end: number): boolean {
  const prev = start > 0 ? text[start - 1] ?? "" : "";
  const next = end < text.length ? text[end] ?? "" : "";
  return !USERNAME_CHAR_RE.test(prev) && !USERNAME_CHAR_RE.test(next);
}

function styledText(value: string, style?: MarkdownInlineStyle): InlineContentTextToken {
  return style ? { kind: "text", value, style } : { kind: "text", value };
}

function tokenizeSymbols(
  text: string,
  style: MarkdownInlineStyle | undefined,
  tokens: InlineContentToken[],
): void {
  let cursor = 0;
  let match: RegExpExecArray | null;

  INLINE_SYMBOL_TOKEN_RE.lastIndex = 0;
  while ((match = INLINE_SYMBOL_TOKEN_RE.exec(text)) !== null) {
    const rawValue = match[0];
    const start = match.index;
    const rawEnd = start + rawValue.length;
    const isTicker = rawValue.startsWith("$");
    const value = isTicker ? trimTrailingTickerPunctuation(rawValue) : rawValue;
    const end = start + value.length;
    if (
      isTicker
        ? !isValidTickerBoundary(text, start, rawEnd)
        : !isValidUsernameBoundary(text, start, rawEnd)
    ) continue;

    if (start > cursor) {
      tokens.push(styledText(text.slice(cursor, start), style));
    }
    tokens.push(isTicker
      ? { kind: "ticker", value, symbol: value.slice(1) }
      : { kind: "username", value, username: value.slice(1) });
    cursor = end;
  }

  if (cursor < text.length) {
    tokens.push(styledText(text.slice(cursor), style));
  }
}

/**
 * Markdown is opt-in: sources like tweets and scraped articles are plain text
 * where stripping `*` or `_` pairs would silently rewrite what the author wrote.
 */
export function tokenizeInlineContent(
  text: string,
  { markdown = false }: { markdown?: boolean } = {},
): InlineContentToken[] {
  const tokens: InlineContentToken[] = [];

  if (!markdown) {
    for (const segment of tokenizeInlineLinks(text)) {
      if (segment.kind === "link") {
        tokens.push(segment);
        continue;
      }
      tokenizeSymbols(segment.value, undefined, tokens);
    }
    return tokens;
  }

  for (const parsed of tokenizeMarkdownInline(text)) {
    if (parsed.kind === "link") {
      tokens.push({ kind: "link", value: parsed.value, url: parsed.url });
      continue;
    }

    // Code spans are literal: no autolinking, tickers, or mentions inside them.
    if (parsed.style?.code) {
      tokens.push(styledText(parsed.value, parsed.style));
      continue;
    }

    for (const segment of tokenizeInlineLinks(parsed.value)) {
      if (segment.kind === "link") {
        tokens.push(segment);
        continue;
      }
      tokenizeSymbols(segment.value, parsed.style, tokens);
    }
  }

  return tokens;
}
