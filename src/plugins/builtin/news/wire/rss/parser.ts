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
/** Rebuild stamps within this window of lastBuildDate are not article dates. */
const LAST_BUILD_DATE_WINDOW_MS = 2 * 60 * 1000;

const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

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

function isUsableDate(date: Date): boolean {
  return Number.isFinite(date.getTime()) && date.getTime() > 0;
}

function matchesLastBuildDate(date: Date, lastBuildDate: Date | null): boolean {
  if (!lastBuildDate || !isUsableDate(date) || !isUsableDate(lastBuildDate)) return false;
  return Math.abs(date.getTime() - lastBuildDate.getTime()) <= LAST_BUILD_DATE_WINDOW_MS;
}

function utcNoon(year: number, monthIndex: number, day: number): Date | null {
  if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, monthIndex, day, 12, 0, 0));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== monthIndex
    || date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Pull a calendar date out of a permalink when pubDate is a feed rebuild stamp. */
export function dateFromRssUrl(url: string): Date | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const iso = trimmed.match(/\/(20\d{2})[/-](\d{2})[/-](\d{2})(?:\/|$)/);
  if (iso) return utcNoon(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const named = trimmed.match(
    /(?:^|[^\p{L}])(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*-(\d{1,2})-?(20\d{2})(?:[^\p{L}]|$)/iu,
  );
  if (named) {
    const month = MONTH_INDEX[named[1]!.toLowerCase()];
    if (month == null) return null;
    return utcNoon(Number(named[3]), month, Number(named[2]));
  }
  const namedDayFirst = trimmed.match(
    /(?:^|[^\p{L}])(\d{1,2})-(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*-(20\d{2})(?:[^\p{L}]|$)/iu,
  );
  if (namedDayFirst) {
    const month = MONTH_INDEX[namedDayFirst[2]!.toLowerCase()];
    if (month == null) return null;
    return utcNoon(Number(namedDayFirst[3]), month, Number(namedDayFirst[1]));
  }
  return null;
}

function firstUsableDate(dates: Date[]): Date | null {
  for (const date of dates) {
    if (isUsableDate(date)) return date;
  }
  return null;
}

function rssItemPublishedAt(block: string, url: string, lastBuildDate: Date | null): Date {
  const pubDate = parseDate(
    extractText(getTagContent(block, "pubDate") || getTagContent(block, "published")),
  );
  const dcDate = parseDate(extractText(getTagContent(block, "dc:date")));
  const atomPublished = parseDate(extractText(getTagContent(block, "atom:published")));
  const updated = parseDate(extractText(getTagContent(block, "updated") || getTagContent(block, "atom:updated")));
  const fromUrl = dateFromRssUrl(url) ?? dateFromRssUrl(extractText(getTagContent(block, "guid") || getTagContent(block, "id")));
  const candidates = [pubDate, dcDate, atomPublished, updated, fromUrl ?? new Date(0)];
  const independent = candidates.filter((date) => isUsableDate(date) && !matchesLastBuildDate(date, lastBuildDate));
  return firstUsableDate(independent) ?? firstUsableDate(candidates) ?? new Date(0);
}

function channelLastBuildDate(xml: string): Date | null {
  const raw = extractText(
    getTagContent(xml, "lastBuildDate") || getTagContent(xml, "updated"),
  );
  const date = parseDate(raw);
  return isUsableDate(date) ? date : null;
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

function parseRss2Items(xml: string, config: RssFeedConfig, lastBuildDate: Date | null): MarketNewsItem[] {
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
    const publishedAt = rssItemPublishedAt(block, url || guid, lastBuildDate);
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

function parseAtomEntries(xml: string, config: RssFeedConfig, lastBuildDate: Date | null): MarketNewsItem[] {
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
    const publishedAt = rssItemPublishedAt(block, url || guid, lastBuildDate);
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
    const lastBuildDate = channelLastBuildDate(xml);
    const isAtom = /<feed\b/i.test(xml);
    if (isAtom) {
      return parseAtomEntries(xml, config, lastBuildDate);
    }
    return parseRss2Items(xml, config, lastBuildDate);
  } catch {
    return [];
  }
}
