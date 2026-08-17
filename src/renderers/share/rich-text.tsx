/** @jsxImportSource react */
/**
 * Article bodies for the slim share page.
 *
 * Shared articles carry text from third parties — reader-extracted markdown, or
 * Substack's own HTML — so both paths here are built to render untrusted input.
 * Neither uses `dangerouslySetInnerHTML`: markdown becomes React nodes, and HTML
 * is walked through a tag/attribute allowlist. A `javascript:` href or an inline
 * handler has no route to the DOM.
 */

import type { ReactNode } from "react";

/** Anything else in an href is dropped rather than rendered as a dead link. */
function safeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

const INLINE_PATTERN = /(\*\*[^*]+\*\*)|(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*[^*]+\*)|(_[^_]+_)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const start = match.index;
    if (start === undefined) continue;
    if (start > cursor) nodes.push(text.slice(cursor, start));
    const token = match[0];
    const key = `${keyPrefix}-i${index++}`;
    if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("[")) {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = safeUrl(token.slice(split + 2, -1));
      nodes.push(href
        ? <a key={key} href={href} target="_blank" rel="noreferrer noopener">{label}</a>
        : label);
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    cursor = start + token.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;

/**
 * A deliberately small block grammar: headings, fenced code, quotes, lists,
 * rules, paragraphs. Reader output rarely uses more, and every construct left
 * out degrades to a paragraph rather than to broken markup.
 */
export function MarkdownBody({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let key = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const joined = paragraph.join(" ").trim();
    paragraph = [];
    if (joined) blocks.push(<p key={`p${key++}`}>{renderInline(joined, `p${key}`)}</p>);
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (line.trimStart().startsWith("```")) {
      flushParagraph();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trimStart().startsWith("```")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      blocks.push(<pre key={`c${key++}`}><code>{code.join("\n")}</code></pre>);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushParagraph();
      blocks.push(<hr key={`h${key++}`} />);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      const level = Math.min(6, heading[1]!.length);
      const Tag = `h${level}` as "h1";
      blocks.push(<Tag key={`t${key++}`}>{renderInline(heading[2] ?? "", `t${key}`)}</Tag>);
      continue;
    }

    if (line.trimStart().startsWith(">")) {
      flushParagraph();
      const quoted: string[] = [];
      while (index < lines.length && (lines[index] ?? "").trimStart().startsWith(">")) {
        quoted.push((lines[index] ?? "").replace(/^\s*>\s?/, ""));
        index += 1;
      }
      index -= 1;
      blocks.push(
        <blockquote key={`q${key++}`}>{renderInline(quoted.join(" ").trim(), `q${key}`)}</blockquote>,
      );
      continue;
    }

    if (LIST_ITEM.test(line)) {
      flushParagraph();
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (index < lines.length && LIST_ITEM.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").match(LIST_ITEM)?.[1] ?? "");
        index += 1;
      }
      index -= 1;
      const listKey = `l${key++}`;
      const children = items.map((item, itemIndex) => (
        <li key={`${listKey}-${itemIndex}`}>{renderInline(item, `${listKey}-${itemIndex}`)}</li>
      ));
      blocks.push(ordered
        ? <ol key={listKey}>{children}</ol>
        : <ul key={listKey}>{children}</ul>);
      continue;
    }

    paragraph.push(line.trim());
  }
  flushParagraph();

  return <div className="share-body">{blocks}</div>;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const ALLOWED_TAGS = new Set([
  "P", "BR", "HR", "STRONG", "B", "EM", "I", "U", "S", "CODE", "PRE",
  "BLOCKQUOTE", "UL", "OL", "LI", "H1", "H2", "H3", "H4", "H5", "H6",
  "A", "IMG", "FIGURE", "FIGCAPTION", "DIV", "SPAN", "SECTION",
]);

/** Tags that only ever wrapped layout; their children are kept, they are not. */
const UNWRAPPED_TAGS = new Set(["DIV", "SPAN", "SECTION", "FIGURE"]);

const VOID_TAGS = new Set(["BR", "HR", "IMG"]);

function convertNode(node: Node, key: string): ReactNode {
  if (node.nodeType === 3) return node.textContent ?? "";
  if (node.nodeType !== 1) return null;

  const element = node as Element;
  const tag = element.tagName.toUpperCase();
  if (!ALLOWED_TAGS.has(tag)) return null;

  const children = VOID_TAGS.has(tag) ? null : convertChildren(element, key);

  if (tag === "A") {
    const href = safeUrl(element.getAttribute("href"));
    if (!href) return children;
    return <a key={key} href={href} target="_blank" rel="noreferrer noopener">{children}</a>;
  }
  if (tag === "IMG") {
    const src = safeUrl(element.getAttribute("src"));
    if (!src) return null;
    return <img key={key} src={src} alt={element.getAttribute("alt") ?? ""} loading="lazy" />;
  }
  if (UNWRAPPED_TAGS.has(tag)) {
    return <div key={key}>{children}</div>;
  }

  const Tag = tag.toLowerCase() as "p";
  return VOID_TAGS.has(tag) ? <Tag key={key} /> : <Tag key={key}>{children}</Tag>;
}

function convertChildren(parent: Node, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  parent.childNodes.forEach((child, index) => {
    const converted = convertNode(child, `${keyPrefix}-${index}`);
    if (converted !== null && converted !== "") nodes.push(converted);
  });
  return nodes;
}

/**
 * Renders third-party HTML through an allowlist. Attributes are never copied
 * wholesale — only `href`/`src` (http(s) only) and `alt` survive — so styles,
 * scripts, and event handlers in the source cannot reach the page.
 */
export function SanitizedHtmlBody({ html }: { html: string }) {
  if (typeof DOMParser === "undefined") {
    return <div className="share-body"><p>{html.replace(/<[^>]*>/g, " ")}</p></div>;
  }
  const parsed = new DOMParser().parseFromString(html, "text/html");
  return <div className="share-body">{convertChildren(parsed.body, "html")}</div>;
}
