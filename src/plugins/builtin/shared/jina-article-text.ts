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
  const seen = new Set<string>();
  for (let i = start; i < blocks.length; i++) {
    if (kinds[i] === "chrome") continue;
    // A lone nav label can be a real subheading; a run of them is a menu.
    if (kinds[i] === "nav-label" && (kinds[i - 1] === "nav-label" || kinds[i + 1] === "nav-label")) continue;
    const key = blockKey(blocks[i]!);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    kept.push(blocks[i]!);
  }
  return kept.join("\n\n").trim();
}

/**
 * True when extracted text is site chrome rather than an article: navigation
 * labels, section names, and menu links with no informative lines. Callers use
 * this to keep a clean summary instead of publishing scraped boilerplate.
 */
export function isBoilerplateArticleBody(text: string): boolean {
  const lines = text
    .split("\n")
    .map(visibleLineText)
    .filter(Boolean);
  if (lines.length === 0) return true;
  if (lines.some(isProseLine)) return false;
  // Nav dumps are many short labels; a genuine short newsletter is a few lines.
  // Only apply the density test once there is enough text to judge, so a real
  // one- or two-line blurb is never discarded as chrome.
  if (lines.length < 4) return false;
  const informative = lines.filter(isInformativeLine).length;
  return informative / lines.length < 0.3;
}

/**
 * Picks the body a reader should show.
 *
 * Extraction only wins when it actually returned an article: paywalls, consent
 * walls, and dead links come back as navigation dumps or short landing pages,
 * which would replace a good summary with something worse.
 */
export function preferredArticleBody(summary: string, fullText: string | null): string {
  const extracted = fullText?.trim() ?? "";
  if (!extracted) return summary;
  const clean = summary.trim();
  if (!clean) return isBoilerplateArticleBody(extracted) ? "" : extracted;
  if (isBoilerplateArticleBody(extracted)) return summary;
  return extracted.length > clean.length ? extracted : summary;
}

type BlockKind = "chrome" | "nav-label" | "content";

function classifyBlock(block: string): BlockKind {
  if (BOT_WALL_RE.test(block)) return "chrome";

  const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return "chrome";

  const visible = lines.map(visibleLineText).filter(Boolean);
  if (visible.length === 0) return "chrome";

  if (visible.every((line) => isChromeLine(line))) return "chrome";
  if (visible.length >= 2) return isNavMenu(visible) ? "chrome" : "content";

  // Single-line blocks are how readers emit one nav link per paragraph.
  if (isLinkOnlyLine(lines[0]!)) return "chrome";
  return isNavLabel(visible[0]!) ? "nav-label" : "content";
}

function blockKey(block: string): string {
  return block
    .split("\n")
    .map(visibleLineText)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isLinkOnlyLine(line: string): boolean {
  const bare = line.replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, "").trim();
  if (!/^\[[^\]]*\]\([^)]*\)$/.test(bare)) return false;
  return !isProseLine(bare);
}

function isNavLabel(line: string): boolean {
  if (isProseLine(line) || isTimestampOrByline(line) || isRelatedHeading(line)) return false;
  return isShortNavLabel(line);
}

function isInformativeLine(line: string): boolean {
  if (isProseLine(line) || isTimestampOrByline(line)) return true;
  return line.length >= 40 || /[.!?]/.test(line);
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
  return text.length <= 32 && !/[.!?]/.test(text);
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
