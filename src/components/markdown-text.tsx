import { Box, Span, Text } from "../ui";
import { useState } from "react";
import { TextAttributes } from "../ui";
import { TickerBadge } from "./ticker/badge";
import { tokenizeTickerText } from "../tickers/tokenizer";
import type { InlineTickerCatalogEntry } from "../state/hooks/inline-tickers";
import { colors } from "../theme/colors";

export interface MarkdownTextProps {
  text: string;
  lineWidth?: number;
  catalog?: Record<string, InlineTickerCatalogEntry>;
  textColor?: string;
  openTicker?: (symbol: string) => void;
}

export interface StyledSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  dim?: boolean;
  code?: boolean;
  underline?: boolean;
  color?: string;
  /** Set for `[label](href)` and `<autolink>` segments; the href is not rendered. */
  link?: string;
}

export interface ParsedLine {
  segments: StyledSegment[];
  heading?: boolean;
  indent?: number;
}

// Order matters: images before links, `**` before `*`, and autolinks before the
// HTML branch so `<https://x>` is not mistaken for a tag.
const INLINE_RE = new RegExp([
  /!\[(?<imageAlt>[^\]]*)\]\((?<imageHref>[^)]*)\)/.source,
  /\[(?<linkText>[^\]]*)\]\((?<linkHref>[^)]*)\)/.source,
  /<(?<autolink>(?:https?:\/\/|mailto:)[^>\s]+)>/.source,
  /<\/?(?<htmlTag>[A-Za-z][A-Za-z0-9-]*)(?:\s[^>]*)?>/.source,
  /\*\*(?<bold>[^*]+)\*\*/.source,
  /(?<!\*)\*(?!\*)(?<italic>[^*]+)\*(?!\*)/.source,
  /`(?<code>[^`]+)`/.source,
  /~~(?<strike>[^~]+)~~/.source,
].join("|"), "g");

function linkSegment(label: string, href: string): StyledSegment {
  return {
    text: label.trim() || href,
    link: href,
    color: colors.borderFocused,
    underline: true,
  };
}

function parseInlineMarkdown(text: string): StyledSegment[] {
  const segments: StyledSegment[] = [];
  let cursor = 0;

  INLINE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > cursor) {
      segments.push({ text: text.slice(cursor, match.index) });
    }
    const groups = match.groups ?? {};
    if (groups.imageAlt != null) {
      // Scraped pages are full of decorative images. Keep a caption only when
      // the alt text carries meaning, and never show the image URL.
      const alt = groups.imageAlt.trim();
      if (alt) segments.push({ text: alt, dim: true, italic: true });
    } else if (groups.linkText != null) {
      segments.push(linkSegment(groups.linkText, groups.linkHref ?? ""));
    } else if (groups.autolink != null) {
      segments.push(linkSegment(groups.autolink, groups.autolink));
    } else if (groups.htmlTag != null) {
      // Filings and scraped pages carry stray tags such as `<u>` around
      // headings. Drop the tag and keep the text it wraps.
    } else if (groups.bold != null) {
      segments.push({ text: groups.bold, bold: true });
    } else if (groups.italic != null) {
      segments.push({ text: groups.italic, italic: true });
    } else if (groups.code != null) {
      segments.push({ text: groups.code, code: true });
    } else if (groups.strike != null) {
      segments.push({ text: groups.strike, dim: true });
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor) });
  }
  return segments;
}

export function parseMarkdownLine(line: string): ParsedLine {
  // Thematic breaks and empty bullets are layout scaffolding in scraped
  // markdown; rendering the raw markers as text is worse than dropping them.
  if (/^\s*([-*_])\1{2,}\s*$/.test(line)) return { segments: [] };
  if (/^\s*(?:[-*+]|\d+\.)\s*$/.test(line)) return { segments: [] };

  const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
  if (headingMatch) {
    // Heading text still needs inline parsing; filings wrap headings in `<u>`
    // and scraped pages put links and emphasis inside them.
    return {
      heading: true,
      segments: parseInlineMarkdown(headingMatch[2]!).map((segment) => ({
        ...segment,
        bold: true,
        color: segment.color ?? colors.borderFocused,
      })),
    };
  }

  const quoteMatch = line.match(/^\s*>\s?(.*)$/);
  if (quoteMatch) {
    return {
      segments: [
        { text: "| ", dim: true },
        ...parseInlineMarkdown(quoteMatch[1]!).map((segment) => ({ ...segment, dim: true })),
      ],
    };
  }

  const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
  if (listMatch) {
    const marker = /^\d/.test(listMatch[2]!) ? listMatch[2]! : "-";
    return {
      indent: listMatch[1]!.length,
      segments: [
        { text: `${marker} `, bold: true, color: colors.borderFocused },
        ...parseInlineMarkdown(listMatch[3]!),
      ],
    };
  }

  return { segments: parseInlineMarkdown(line) };
}

const TABLE_ROW_RE = /^\s*\|(.+)\|\s*$/;
const TABLE_DIVIDER_CELL_RE = /^:?-+:?$/;
/** Keeps one wide cell from pushing every later column off screen. */
const MAX_TABLE_COLUMN_WIDTH = 32;
const TABLE_COLUMN_GAP = 2;

function tableCells(line: string): string[] | null {
  const match = line.match(TABLE_ROW_RE);
  if (!match) return null;
  return match[1]!.split("|").map((cell) => cell.trim());
}

function isTableDivider(cells: string[]): boolean {
  return cells.every((cell) => TABLE_DIVIDER_CELL_RE.test(cell));
}

function segmentsWidth(segments: StyledSegment[]): number {
  return segments.reduce((total, segment) => total + segment.text.length, 0);
}

/**
 * Renders a pipe table as space-aligned columns. Terminal output has no table
 * primitive here, and showing the raw `|---|` scaffolding is worse than
 * dropping it, which is how thematic breaks are already handled.
 */
function parseTableBlock(rawRows: string[][]): ParsedLine[] {
  let headerIndex: number | null = null;
  const rows: string[][] = [];
  for (const cells of rawRows) {
    if (isTableDivider(cells)) {
      // A divider marks the row above it as the header.
      if (headerIndex === null && rows.length > 0) headerIndex = rows.length - 1;
      continue;
    }
    rows.push(cells);
  }
  if (rows.length === 0) return [];

  const parsedRows = rows.map((cells) => cells.map((cell) => parseInlineMarkdown(cell)));
  const widths: number[] = [];
  for (const row of parsedRows) {
    row.forEach((cell, column) => {
      const width = Math.min(segmentsWidth(cell), MAX_TABLE_COLUMN_WIDTH);
      widths[column] = Math.max(widths[column] ?? 0, width);
    });
  }

  return parsedRows.map((row, rowIndex) => {
    const isHeader = rowIndex === headerIndex;
    const segments: StyledSegment[] = [];
    row.forEach((cell, column) => {
      if (column > 0) segments.push({ text: " ".repeat(TABLE_COLUMN_GAP) });
      segments.push(
        ...(isHeader ? cell.map((segment) => ({ ...segment, bold: true })) : cell),
      );
      // The last column needs no padding; nothing follows it.
      if (column < row.length - 1) {
        const padding = (widths[column] ?? 0) - segmentsWidth(cell);
        if (padding > 0) segments.push({ text: " ".repeat(padding) });
      }
    });
    return { segments };
  });
}

/**
 * Parses a whole document. Tables have to be grouped before rendering because
 * column widths depend on every row in the block.
 */
export function parseMarkdownDocument(text: string): ParsedLine[] {
  const lines = text.split("\n");
  const parsed: ParsedLine[] = [];
  let index = 0;

  while (index < lines.length) {
    const cells = tableCells(lines[index]!);
    if (cells) {
      const rawRows: string[][] = [];
      while (index < lines.length) {
        const next = tableCells(lines[index]!);
        if (!next) break;
        rawRows.push(next);
        index += 1;
      }
      parsed.push(...parseTableBlock(rawRows));
      continue;
    }
    parsed.push(parseMarkdownLine(lines[index]!));
    index += 1;
  }

  return parsed;
}

function wrappedTextStyle() {
  return {
    minWidth: 0,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  } as const;
}

function wrappedInlineTextStyle() {
  return {
    ...wrappedTextStyle(),
    display: "inline",
  } as const;
}

function SegmentSpan({ segment, wrap = false }: { segment: StyledSegment; wrap?: boolean }) {
  const wrapProps = wrap
    ? {
        wrapText: true,
        wrapMode: "word",
        style: wrappedInlineTextStyle(),
      }
    : {};

  if (segment.code) {
    return <Span fg={colors.textDim} {...wrapProps}>{segment.text}</Span>;
  }
  const attrs =
    (segment.bold ? TextAttributes.BOLD : 0) |
    (segment.italic ? TextAttributes.ITALIC : 0) |
    (segment.dim ? TextAttributes.DIM : 0) |
    (segment.underline ? TextAttributes.UNDERLINE : 0);
  return (
    <Span
      fg={segment.color ?? undefined}
      attributes={attrs || undefined}
      {...wrapProps}
    >
      {segment.text}
    </Span>
  );
}

function MarkdownLine({
  parsed,
  lineWidth,
  catalog,
  textColor,
  openTicker,
  hoveredSymbol,
  onHover,
}: {
  parsed: ParsedLine;
  lineWidth?: number;
  catalog: Record<string, InlineTickerCatalogEntry>;
  textColor: string;
  openTicker: (symbol: string) => void;
  hoveredSymbol: string | null;
  onHover: (symbol: string | null) => void;
}) {
  const indent = parsed.indent ?? 0;
  const indentStr = indent > 0 ? " ".repeat(indent) : "";
  const shouldWrap = lineWidth != null;
  const textWrapProps = shouldWrap
    ? {
        width: lineWidth,
        wrapText: true,
        wrapMode: "word",
        style: wrappedTextStyle(),
      }
    : {};

  // Check if any segment contains ticker symbols
  const fullText = parsed.segments.map((s) => s.text).join("");
  const tickerTokens = tokenizeTickerText(fullText);
  const hasTickers = tickerTokens.some((t) => t.kind === "ticker" && catalog[t.symbol]?.status !== "missing");

  if (!hasTickers) {
    // Simple case: no tickers, render as styled text
    return (
      <Text fg={textColor} {...textWrapProps}>
        {indentStr}
        {parsed.segments.map((segment, i) => (
          <SegmentSpan key={i} segment={segment} wrap={shouldWrap} />
        ))}
      </Text>
    );
  }

  // Complex case: need to handle tickers within styled segments
  // Render as a flex row to allow badge elements
  return (
    <Box flexDirection="row" flexWrap="wrap" {...(lineWidth != null ? { width: lineWidth } : {})}>
      {indentStr ? <Text fg={textColor}>{indentStr}</Text> : null}
      {parsed.segments.map((segment, segIdx) => {
        // A link label is a unit; tickerising inside it would split the label.
        if (segment.link) {
          return (
            <Text
              key={segIdx}
              fg={textColor}
              {...(shouldWrap
                ? { wrapText: true, wrapMode: "word", style: wrappedTextStyle() }
                : {})}
            >
              <SegmentSpan segment={segment} wrap={shouldWrap} />
            </Text>
          );
        }
        return tokenizeTickerText(segment.text).map((token, tokIdx) => {
          if (token.kind === "text") {
            if (!token.value) return null;
            return (
              <Text
                key={`${segIdx}:${tokIdx}`}
                fg={textColor}
                {...(shouldWrap
                  ? { wrapText: true, wrapMode: "word", style: wrappedTextStyle() }
                  : {})}
              >
                <SegmentSpan segment={{ ...segment, text: token.value }} wrap={shouldWrap} />
              </Text>
            );
          }
          const entry = catalog[token.symbol];
          if (!entry || entry.status === "missing") {
            return (
              <Text
                key={`${segIdx}:${tokIdx}`}
                fg={textColor}
                {...(shouldWrap
                  ? { wrapText: true, wrapMode: "word", style: wrappedTextStyle() }
                  : {})}
              >
                <SegmentSpan segment={{ ...segment, text: token.value }} wrap={shouldWrap} />
              </Text>
            );
          }
          return (
            <TickerBadge
              key={`badge:${segIdx}:${tokIdx}:${token.symbol}`}
              symbol={token.symbol}
              status={entry.status}
              quote={entry.quote}
              hovered={hoveredSymbol === token.symbol}
              onHoverStart={() => onHover(token.symbol)}
              onHoverEnd={() => onHover(null)}
              onOpen={openTicker}
            />
          );
        });
      })}
    </Box>
  );
}

export function MarkdownText({
  text,
  lineWidth,
  catalog = {},
  textColor = colors.text,
  openTicker = () => {},
}: MarkdownTextProps) {
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);
  const lines = parseMarkdownDocument(text);

  return (
    <Box flexDirection="column" {...(lineWidth != null ? { width: lineWidth } : {})}>
      {lines.map((parsed, index) => {
        if (parsed.segments.length === 0) {
          return <Text key={index}>{" "}</Text>;
        }
        return (
          <MarkdownLine
            key={index}
            parsed={parsed}
            lineWidth={lineWidth}
            catalog={catalog}
            textColor={textColor}
            openTicker={openTicker}
            hoveredSymbol={hoveredSymbol}
            onHover={setHoveredSymbol}
          />
        );
      })}
    </Box>
  );
}
