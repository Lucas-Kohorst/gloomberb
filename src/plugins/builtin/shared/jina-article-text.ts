/**
 * Shared Jina reader text helpers.
 *
 * Both the in-app article reader and the public share page fetch
 * `r.jina.ai`. Keep request options and post-processing here so they stay
 * consistent — and so the share bundle does not have to import the TUI reader.
 */

export const JINA_READER_ENDPOINT = "https://r.jina.ai/";

/**
 * Jina's default content timing is `resource-idle`: it waits for images,
 * fonts, and other subresources to go quiet. Articles only need readable
 * text, and images are unused in the terminal reader.
 *
 * Do not set `X-Timeout` or `X-Wait-For-Selector` — both force Jina to
 * sit until the deadline instead of returning early.
 */
export const JINA_READER_HEADERS: Record<string, string> = {
  Accept: "text/plain",
  "X-Respond-Timing": "visible-content",
  "X-Retain-Images": "none",
};

const BOT_WALL_RE = (
  /javascript and cookies|please enable javascript|please enable cookies|enable javascript and cookies|ad[\s-]?blocker enabled|you have an ad[\s-]?blocker|disable your ad[\s-]?blocker|whitelist(?:ed)? this (?:site|page)|press\s*(?:&|and)\s*hold to confirm|confirm you are\s*(?:a )?human|(?:a )?human \(and not a bot\)|access to this page has been denied|before we continue/i
);

const SKIP_CHROME_RE = /^(?:\[?skip to (?:content|main(?: content)?|navigation|article|primary)\]?|skip navigation)$/i;

const ACCOUNT_CHROME_RE = (
  /^(?:create (?:a )?free account|sign[\s-]?in(?: to \w+)?|log[\s-]?in|sign[\s-]?up|subscribe(?: now)?|get (?:the )?app|download (?:the )?app)$/i
);

const FOOTER_CHROME_RE = /^(?:©|\(c\)|copyright\b|terms of (?:use|service)|privacy policy|all rights reserved|cookie (?:policy|settings|preferences))$/i;

const NAV_HEADINGS = new Set([
  "stock analysis",
  "market news",
  "earnings",
  "dividends",
  "filings",
  "ipo",
  "ipos",
  "portfolio",
  "watchlists",
  "alerts",
  "markets",
  "investing",
  "newsletters",
  "help",
  "about",
  "site map",
  "sitemap",
  "quant",
]);

/**
 * The reader prefixes every response with `Title:` / `URL Source:` /
 * `Published Time:` lines. The pane already renders the title and source, so
 * keeping them would repeat that metadata as the first lines of the body.
 */
export function stripJinaPreamble(raw: string): string {
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (!text.startsWith("Title:")) return text;
  const marker = text.match(/^Markdown Content:[ \t]*$/m);
  if (marker?.index == null) return text;
  return text.slice(marker.index + marker[0].length).trim();
}

/**
 * Drop site chrome and bot-wall copy that Jina includes when readability
 * fails (Seeking Alpha is the usual case: skip-to-content, nav menus,
 * "enable Javascript and cookies", ad-blocker warnings). Keep the first
 * real article block and anything after it, including "More on …" links.
 *
 * Returns an empty string when the page is only a challenge wall so a
 * share payload can keep its summary instead of replacing it with junk.
 */
export function cleanJinaArticle(raw: string): string {
  const stripped = stripJinaPreamble(raw);
  if (!stripped) return "";

  const blocks = stripped.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  if (blocks.length === 0) return "";

  const kinds = blocks.map(classifyBlock);
  const start = kinds.findIndex((kind) => kind === "content");
  if (start === -1) return "";

  const kept: string[] = [];
  for (let i = start; i < blocks.length; i++) {
    if (kinds[i] === "chrome") continue;
    kept.push(blocks[i]!);
  }
  return kept.join("\n\n").trim();
}

type BlockKind = "chrome" | "content";

function classifyBlock(block: string): BlockKind {
  if (BOT_WALL_RE.test(block)) return "chrome";

  const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return "chrome";

  const visible = lines.map(visibleLineText).filter(Boolean);
  if (visible.length === 0) return "chrome";

  if (visible.every((line) => isChromeLine(line))) return "chrome";
  if (isNavMenu(visible)) return "chrome";
  return "content";
}

function isNavMenu(lines: string[]): boolean {
  if (lines.some((line) => isProseLine(line) || isTimestampOrByline(line) || isRelatedHeading(line))) {
    return false;
  }
  if (lines.length < 2) return false;
  const chromeish = lines.filter((line) => isChromeLine(line) || isShortNavLabel(line));
  return chromeish.length / lines.length >= 0.7;
}

function isChromeLine(line: string): boolean {
  const text = visibleLineText(line);
  if (!text) return true;
  if (SKIP_CHROME_RE.test(text)) return true;
  if (ACCOUNT_CHROME_RE.test(text)) return true;
  if (FOOTER_CHROME_RE.test(text)) return true;
  if (NAV_HEADINGS.has(text.toLowerCase())) return true;
  return false;
}

function isShortNavLabel(line: string): boolean {
  const text = visibleLineText(line);
  if (!text) return true;
  if (isProseLine(text) || isTimestampOrByline(text)) return false;
  return text.length < 28 && !/[.!?]/.test(text);
}

function isProseLine(line: string): boolean {
  const text = visibleLineText(line);
  if (text.length >= 80) return true;
  if (text.length >= 40 && /[.!?]/.test(text)) return true;
  return false;
}

function isTimestampOrByline(line: string): boolean {
  const text = visibleLineText(line);
  if (/^by:?\s+\S/i.test(text)) return true;
  if (/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}/i.test(text)) {
    return true;
  }
  return /\b\d{1,2}:\d{2}\s*(?:am|pm)(?:\s*(?:et|pt|utc|gmt))?\b/i.test(text);
}

function isRelatedHeading(line: string): boolean {
  return /^more on\b/i.test(visibleLineText(line));
}

function visibleLineText(line: string): string {
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/[*_`]+/g, "")
    .trim();
}
