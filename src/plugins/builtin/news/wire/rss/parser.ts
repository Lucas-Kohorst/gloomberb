import type { MarketNewsItem } from "../../../../../types/news-source";
import { decodeHtmlEntities } from "../../../../../utils/html-entities";
import { htmlToPlainText, readableArticleText } from "../../../shared/jina-article-text";
import { hashString } from "../hash";

export interface RssFeedConfig {
  id: string;
  url: string;
  name: string;
  category?: string;
  authority: number; // 0-100
  enabled: boolean;
}

export const RSS_FEED_ITEM_LIMIT = 40;

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, inner) => inner);
}

function stripHtml(s: string): string {
  return htmlToPlainText(s);
}

function extractText(s: string): string {
  // Decode entities first so escaped HTML tags become real tags, then strip them
  return readableArticleText(decodeHtmlEntities(stripCdata(s)));
}

function getTagContent(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? m[1]!.trim() : "";
}

/** Full item text from content:encoded plus description, HTML-stripped. */
export function combineRssFullText(encoded: string, description: string): string {
  const a = encoded.trim();
  const b = description.trim();
  if (!a) return b;
  if (!b) return a;
  if (a.includes(b) || b.includes(a)) return a.length >= b.length ? a : b;
  return `${a}\n\n${b}`;
}

/** Prefer the encoded article body; fall back to a long description. */
export function rssInlineBody(encoded: string, description: string): string | undefined {
  const encodedText = encoded.trim();
  const combined = combineRssFullText(encodedText, description);
  if (encodedText) return combined || undefined;
  if (combined.length > 500) return combined;
  return undefined;
}

export function rssFullTextFromItemXml(block: string): string {
  const encoded = extractText(
    getTagContent(block, "content:encoded") || getTagContent(block, "content"),
  );
  const description = extractText(
    getTagContent(block, "description") || getTagContent(block, "summary"),
  );
  return combineRssFullText(encoded, description);
}

function parseDate(s: string): Date {
  const trimmed = s.trim();
  if (!trimmed) return new Date(0);
  // Fast Company and other WordPress feeds emit ISO-8601 without a timezone.
  // `new Date("2026-08-25T13:04:00")` is local time, so US sessions show every
  // item as `<1m`. Treat timezone-less ISO as UTC.
  const isoWithoutTz = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(trimmed);
  const parsed = new Date(isoWithoutTz ? `${trimmed}Z` : trimmed);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function rssGuid(block: string): string {
  return extractText(getTagContent(block, "guid") || getTagContent(block, "id"));
}

function rssItemIdentity(guid: string, url: string, title: string): string {
  return guid.trim() || url.trim() || title.trim();
}

function rssItemId(guid: string, url: string, title: string): string {
  return hashString(rssItemIdentity(guid, url, title).toLowerCase());
}

function rssDedupeKeys(guid: string, url: string): string[] {
  const keys: string[] = [];
  const normalizedGuid = guid.trim().toLowerCase();
  if (normalizedGuid) keys.push(`g:${normalizedGuid}`);
  const normalizedUrl = url.trim().toLowerCase().replace(/\/$/, "");
  if (normalizedUrl) keys.push(`u:${normalizedUrl}`);
  return keys;
}

function rememberItemKeys(seen: Set<string>, guid: string, url: string): boolean {
  const keys = rssDedupeKeys(guid, url);
  const duplicate = keys.some((key) => seen.has(key));
  for (const key of keys) seen.add(key);
  return duplicate;
}

function extractAttr(tag: string, attr: string): string {
  const m = tag.match(new RegExp(`${attr}="([^"]*)"`, "i"));
  return m ? m[1]! : "";
}

function extractImageUrl(block: string): string | undefined {
  // media:content url="..." (common in RSS 2.0 with media namespace)
  const mediaContent = block.match(/<media:content[^>]+url="([^"]+)"[^>]*(?:medium="image"|type="image\/)/i);
  if (mediaContent) return mediaContent[1]!;

  // media:content without explicit type (take first one with a url)
  const mediaAny = block.match(/<media:content[^>]+url="([^"]+)"/i);
  if (mediaAny) return mediaAny[1]!;

  // media:thumbnail url="..."
  const mediaThumbnail = block.match(/<media:thumbnail[^>]+url="([^"]+)"/i);
  if (mediaThumbnail) return mediaThumbnail[1]!;

  // enclosure with image type
  const enclosure = block.match(/<enclosure[^>]+url="([^"]+)"[^>]+type="image\//i);
  if (enclosure) return enclosure[1]!;

  // img src inside description/content CDATA
  const imgSrc = block.match(/<img[^>]+src="(https?:\/\/[^"]+)"/i);
  if (imgSrc) return imgSrc[1]!;

  return undefined;
}

function parseRss2Items(xml: string, config: RssFeedConfig): MarketNewsItem[] {
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  const items: MarketNewsItem[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = itemRe.exec(xml)) !== null) {
    if (items.length >= RSS_FEED_ITEM_LIMIT) break;
    const block = match[1]!;

    const title = extractText(getTagContent(block, "title"));
    const url = extractText(getTagContent(block, "link"));
    const guid = rssGuid(block);
    const pubDateRaw = extractText(getTagContent(block, "pubDate"));
    const descRaw = getTagContent(block, "description");
    const desc = descRaw ? extractText(descRaw) : "";
    const encoded = extractText(getTagContent(block, "content:encoded"));
    const categoryRaw = getTagContent(block, "category");
    const category = categoryRaw ? extractText(categoryRaw) : undefined;

    if (!title && !url && !guid) continue;
    if (rememberItemKeys(seen, guid, url || guid)) continue;

    const summary = desc
      ? desc.slice(0, 300) + (desc.length > 300 ? "…" : "")
      : undefined;
    const body = rssInlineBody(encoded, desc);

    const id = rssItemId(guid, url, title);
    const publishedAt = parseDate(pubDateRaw);
    const categories = category ? [category] : config.category ? [config.category] : [];
    const imageUrl = extractImageUrl(block);

    items.push({
      id,
      title,
      url: url || guid,
      guid: guid || undefined,
      source: config.name,
      publishedAt,
      summary,
      body,
      imageUrl,
      topic: categories[0] ?? "general",
      topics: categories,
      sectors: [],
      categories,
      tickers: [],
      scores: {
        importance: 0,
        urgency: 0,
        marketImpact: 0,
        novelty: 0,
        confidence: 0,
      },
      importance: 0,
      isBreaking: false,
      isDeveloping: false,
    });
  }

  return items;
}

function parseAtomEntries(xml: string, config: RssFeedConfig): MarketNewsItem[] {
  const entryRe = /<entry>([\s\S]*?)<\/entry>/gi;
  const items: MarketNewsItem[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = entryRe.exec(xml)) !== null) {
    if (items.length >= RSS_FEED_ITEM_LIMIT) break;
    const block = match[1]!;

    const title = extractText(getTagContent(block, "title"));

    // Atom <link href="..."/> or <link>...</link>
    const linkTagMatch = block.match(/<link([^>]*)>/i);
    let url = "";
    if (linkTagMatch) {
      const href = extractAttr(linkTagMatch[0]!, "href");
      if (href) {
        url = href;
      } else {
        url = extractText(getTagContent(block, "link"));
      }
    }

    const publishedRaw =
      extractText(getTagContent(block, "published")) ||
      extractText(getTagContent(block, "updated"));

    const summaryRaw = getTagContent(block, "summary");
    const contentRaw = getTagContent(block, "content");
    const summaryFull = summaryRaw ? extractText(summaryRaw) : "";
    const contentFull = contentRaw ? extractText(contentRaw) : "";
    const summary = summaryFull
      ? summaryFull.slice(0, 300) + (summaryFull.length > 300 ? "…" : "")
      : undefined;
    const body = rssInlineBody(contentFull, summaryFull);

    const guid = rssGuid(block);
    if (!title && !url && !guid) continue;
    if (rememberItemKeys(seen, guid, url || guid)) continue;

    const id = rssItemId(guid, url, title);
    const publishedAt = parseDate(publishedRaw);
    const categories = config.category ? [config.category] : [];
    const imageUrl = extractImageUrl(block);

    items.push({
      id,
      title,
      url: url || guid,
      guid: guid || undefined,
      source: config.name,
      publishedAt,
      summary,
      body,
      imageUrl,
      topic: categories[0] ?? "general",
      topics: categories,
      sectors: [],
      categories,
      tickers: [],
      scores: {
        importance: 0,
        urgency: 0,
        marketImpact: 0,
        novelty: 0,
        confidence: 0,
      },
      importance: 0,
      isBreaking: false,
      isDeveloping: false,
    });
  }

  return items;
}

export function parseRssFeed(xml: string, config: RssFeedConfig): MarketNewsItem[] {
  if (!xml || !xml.trim()) return [];

  try {
    const isAtom = /<feed\b/i.test(xml);
    if (isAtom) {
      return parseAtomEntries(xml, config);
    }
    return parseRss2Items(xml, config);
  } catch {
    return [];
  }
}
