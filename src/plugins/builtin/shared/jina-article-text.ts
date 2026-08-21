/**
 * Shared Jina reader text helpers.
 *
 * Both the in-app article reader and the public share page fetch
 * `r.jina.ai`. Keep request options and post-processing here so they stay
 * consistent — and so the share bundle does not have to import the TUI reader.
 */

export const JINA_READER_ENDPOINT = "https://r.jina.ai/";

/**
 * True when the string contains a real HTML element.
 *
 * Autolinks (`<https://...>`) and comparisons (`polls < 50%`) must not count:
 * `DOMParser` will treat those as tags and an allowlist sanitizer will drop
 * everything inside them.
 */
export function htmlMarkupPresent(value: string): boolean {
  return /<\/?[a-zA-Z][a-zA-Z0-9]*(\s|\/?>)/.test(value);
}

const HTML_DOCUMENT_RE = /<!DOCTYPE\s+html|<html[\s>]|<head[\s>]|<body[\s>]/i;

/** True when Jina (or an RSS field) handed us a page dump rather than article text. */
export function looksLikeHtmlDocument(value: string): boolean {
  const sample = value.slice(0, 2000);
  return HTML_DOCUMENT_RE.test(sample);
}

/**
 * Turn HTML into readable plaintext. Script/style are dropped; block tags
 * become paragraph breaks so a later markdown render still has structure.
 */
export function htmlToPlainText(value: string): string {
  return value
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
    .replace(/<title\b[\s\S]*?<\/title>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr|section|article|ul|ol)>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Body a reader can show as markdown. HTML dumps become plaintext; already
 * readable text is left alone so autolinks and markdown stay intact.
 */
export function readableArticleText(value: string | undefined | null): string {
  const text = value?.replace(/\r\n?/g, "\n").trim() ?? "";
  if (!text) return "";
  if (looksLikeHtmlDocument(text) || htmlMarkupPresent(text)) return htmlToPlainText(text);
  return text;
}

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

/** RSS content:encoded (or a long description) is already a full article. */
export const RSS_INLINE_BODY_MIN_CHARS = 500;

const PAYWALL_STUB_RE = (
  /this (?:post|article|story) is for (?:paying |paid )?subscribers|subscribe to (?:continue|keep) reading|already a paid subscriber|continue reading this post|the rest of this (?:article|post) is (?:only )?for subscribers|become a (?:paid )?subscriber|sign up to (?:read|continue)|members[- ]only|subscriber[- ]only content/i
);

/** Paywall landing copy — keep a summary rather than publishing the stub. */
export function isPaywallStub(text: string): boolean {
  const visible = text.replace(/\s+/g, " ").trim();
  if (!visible) return false;
  if (visible.length > 400 && !PAYWALL_STUB_RE.test(visible.slice(0, 400))) return false;
  return PAYWALL_STUB_RE.test(visible);
}

export function shouldSkipJinaForKnownBody(body: string | undefined | null): boolean {
  const readable = readableArticleText(body);
  if (readable.length < RSS_INLINE_BODY_MIN_CHARS) return false;
  if (isPaywallStub(readable) || isBoilerplateArticleBody(readable)) return false;
  return true;
}

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
  const stripped = readableArticleText(stripJinaPreamble(raw));
  if (!stripped) return "";
  if (isPaywallStub(stripped)) return "";

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
    if (isPaywallStub(blocks[i]!)) continue;
    const key = blockKey(blocks[i]!);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    kept.push(blocks[i]!);
  }
  const cleaned = kept.join("\n\n").trim();
  return isPaywallStub(cleaned) ? "" : cleaned;
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
  const extractedRaw = fullText?.trim() ?? "";
  const extracted = extractedRaw && (isPaywallStub(extractedRaw) || isBoilerplateArticleBody(extractedRaw))
    ? ""
    : extractedRaw;
  if (!extracted) return summary;
  const clean = summary.trim();
  if (!clean) return extracted;
  if (isPaywallStub(clean)) return extracted;
  return extracted.length > clean.length ? extracted : summary;
}

/** Why a Jina/reader extraction failed — drives user-facing copy. */
export type ReaderFailureKind = "blocked" | "auth" | "timeout" | "network" | "http" | "unknown";

export interface ReaderFailure {
  kind: ReaderFailureKind;
  /** Short, changeable footer status (not the body explanation). */
  status: string;
  /** Body copy explaining what happened and what the user can do. */
  message: string;
}

const ABUSE_OR_BLOCK_RE = (
  /AbuseAlleviationError|anonymous access to domain|access to this page has been denied|captcha|ddos attack suspected|too many requests|forbidden|blocked until/i
);

/**
 * Map an HTTP failure (and optional response body) into user-facing reader state.
 *
 * Publishers like Investing.com are blocked at Jina's abuse layer (403 +
 * AbuseAlleviationError). That is expected for some feeds — not a network bug.
 */
export function classifyReaderHttpFailure(status: number, body = ""): ReaderFailure {
  const text = body.trim();
  if (status === 401 || status === 407) {
    return {
      kind: "auth",
      status: "reader auth failed",
      message: "Article reader authentication failed.",
    };
  }
  if (status === 403 || status === 451 || ABUSE_OR_BLOCK_RE.test(text)) {
    return {
      kind: "blocked",
      status: "blocked",
      message: "Full text unavailable — this publisher blocks automated readers.",
    };
  }
  if (status === 408 || status === 504) {
    return {
      kind: "timeout",
      status: "reader timed out",
      message: "The article reader timed out.",
    };
  }
  if (status === 429) {
    return {
      kind: "blocked",
      status: "reader rate limited",
      message: "The article reader is rate-limited right now.",
    };
  }
  if (status >= 500) {
    return {
      kind: "http",
      status: "reader unavailable",
      message: "The article reader is temporarily unavailable.",
    };
  }
  return {
    kind: "http",
    status: "reader failed",
    message: `Could not load the full article (HTTP ${status}).`,
  };
}

/** Map a thrown fetch/abort error into user-facing reader state. */
export function classifyReaderThrow(error: unknown): ReaderFailure {
  if (
    error
    && typeof error === "object"
    && "readerFailure" in error
    && isReaderFailure((error as { readerFailure: unknown }).readerFailure)
  ) {
    return (error as { readerFailure: ReaderFailure }).readerFailure;
  }
  if (isReaderFailure(error)) {
    return { kind: error.kind, status: error.status, message: error.message };
  }
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "AbortError" || /aborted|timed?\s*out|timeout/i.test(message)) {
    return {
      kind: "timeout",
      status: "reader timed out",
      message: "The article reader timed out.",
    };
  }
  if (/failed to fetch|networkerror|network request failed|econnreset|enotfound|econnrefused/i.test(message)) {
    return {
      kind: "network",
      status: "reader offline",
      message: "Could not reach the article reader. Check your connection.",
    };
  }
  return {
    kind: "unknown",
    status: "reader failed",
    message: "Could not load the full article.",
  };
}

export function isReaderFailure(value: unknown): value is ReaderFailure {
  return (
    !!value
    && typeof value === "object"
    && "kind" in value
    && "status" in value
    && "message" in value
    && typeof (value as ReaderFailure).kind === "string"
    && typeof (value as ReaderFailure).status === "string"
    && typeof (value as ReaderFailure).message === "string"
  );
}

/**
 * Body note shown above fallback/summary text when extraction failed.
 * Kept shorter than `failure.message` so the footer can own the status line.
 */
export function readerFallbackNotice(kind: ReaderFailureKind | null | undefined, hasFallback: boolean): string | null {
  if (!kind) return null;
  if (kind === "blocked") {
    return hasFallback
      ? "Showing available summary — full text blocked by this publisher."
      : null;
  }
  if (kind === "timeout" || kind === "network" || kind === "http" || kind === "auth" || kind === "unknown") {
    return hasFallback ? "Showing available summary — full text could not be loaded." : null;
  }
  return null;
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
