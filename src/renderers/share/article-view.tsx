/** @jsxImportSource react */
/**
 * Shared article view.
 *
 * Whatever text the payload carries is rendered on the first frame, and the full
 * body is fetched afterwards only when the payload has none. Waiting on the
 * reader service before painting would trade the one thing a share has to be —
 * immediate — for text the visitor cannot read yet anyway.
 */

import { useEffect, useState } from "react";
import type { ArticleSharePayload } from "../../shares/payload";
import {
  cleanJinaArticle,
  classifyReaderHttpFailure,
  classifyReaderThrow,
  htmlMarkupPresent,
  isReaderChrome,
  looksLikeHtmlDocument,
  preferredArticleBody,
  readableArticleText,
  readerFallbackNotice,
  type ReaderFailureKind,
  JINA_READER_ENDPOINT,
  JINA_READER_HEADERS,
} from "../../plugins/builtin/shared/jina-article-text";
import { stripLeadingHeading } from "../../plugins/builtin/adjacent/filings-format";
import { MarkdownBody, SanitizedHtmlBody } from "./rich-text";
import { useShareArticleArchive } from "./archive-action";
import { ShareShell, formatShareTimestamp } from "./shell";

export { preferredArticleBody };

export type ArticleShareBodySource =
  | { kind: "html"; html: string }
  | { kind: "markdown"; text: string }
  | { kind: "empty" };

/**
 * Snapshot text wins. `bodyHtml` is post markup when the sharer had HTML, and
 * plain text when the reader extracted the post. Treating the latter as HTML
 * lets `DOMParser` eat the article at the first `<https://...>` autolink.
 */
export function articleShareBodySource(
  payload: ArticleSharePayload,
  extractedText: string | null = null,
): ArticleShareBodySource {
  const embedded = payload.bodyHtml?.trim() || "";
  const summary = payload.summary?.trim() || payload.previewText?.trim() || "";
  if (embedded && htmlMarkupPresent(embedded) && !looksLikeHtmlDocument(embedded)) {
    return { kind: "html", html: embedded };
  }
  const text = preferredArticleBody(
    readableArticleText(summary) || summary,
    readableArticleText(embedded) || embedded || extractedText,
  );
  const cleaned = text ? (cleanJinaArticle(text) || text) : "";
  return cleaned ? { kind: "markdown", text: cleaned } : { kind: "empty" };
}

export function articleShareNeedsReader(payload: ArticleSharePayload): boolean {
  const embedded = payload.bodyHtml?.trim() || "";
  if (embedded && htmlMarkupPresent(embedded) && !looksLikeHtmlDocument(embedded)) return false;
  const snapshot = articleShareBodySource(payload);
  // A full extracted post in the snapshot should not be replaced by a later
  // Jina fetch that often returns the Substack teaser for logged-in visitors.
  if (snapshot.kind === "markdown" && snapshot.text.length >= 400) return false;
  if (!payload.url) return false;
  if (payload.items?.length) return false;
  // Tweets already snapshot their text; x.com/twitter.com login walls are not articles.
  if (isXStatusUrl(payload.url)) return false;
  return payload.type === "news" || payload.type === "substack";
}

function articleTickers(tickers: string[] | undefined): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const raw of tickers ?? []) {
    const label = raw.trim().toUpperCase();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
    if (labels.length >= 8) break;
  }
  return labels;
}

const CFTC_FILING_SHARE_ID = /^cftc:(\d+)$/;
const FILING_SNAPSHOT_ENOUGH = 400;

export function cftcFilingIdFromShare(id: string): number | null {
  const match = CFTC_FILING_SHARE_ID.exec(id.trim());
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** Same-origin proxy first. Adjacent's public filings API is the fallback. */
export function cftcFilingMarkdownUrls(id: number, origin?: string): string[] {
  const path = `public/filings/${id}/markdown`;
  const direct = `https://api.adjacent.markets/api/v1/${path}`;
  const hosted = origin?.replace(/\/$/, "");
  if (hosted && /^https?:\/\//i.test(hosted)) {
    return [`${hosted}/api/data/adjacent/${path}`, direct];
  }
  return [direct];
}

export function filingShareNeedsText(id: string, snapshotChars: number): boolean {
  return cftcFilingIdFromShare(id) != null && snapshotChars < FILING_SNAPSHOT_ENOUGH;
}

function filingMarkdownFromPayload(payload: unknown): { text: string; sourceUrl: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as { markdown?: unknown; source_url?: unknown };
  const text = typeof record.markdown === "string" ? record.markdown.trim() : "";
  if (!text) return null;
  const sourceUrl = typeof record.source_url === "string" ? record.source_url.trim() : "";
  return { text, sourceUrl };
}

function useCftcFilingText(id: string, enabled: boolean) {
  const [state, setState] = useState<{
    text: string | null;
    sourceUrl: string | null;
    loading: boolean;
  }>({ text: null, sourceUrl: null, loading: enabled });

  useEffect(() => {
    const filingId = cftcFilingIdFromShare(id);
    if (!enabled || filingId == null) {
      setState({ text: null, sourceUrl: null, loading: false });
      return;
    }
    const controller = new AbortController();
    const origin = typeof location !== "undefined" ? location.origin : undefined;
    setState({ text: null, sourceUrl: null, loading: true });
    void (async () => {
      for (const url of cftcFilingMarkdownUrls(filingId, origin)) {
        if (controller.signal.aborted) return;
        try {
          const response = await fetch(url, {
            signal: controller.signal,
            headers: { Accept: "application/json" },
          });
          if (!response.ok) continue;
          const parsed = filingMarkdownFromPayload(await response.json());
          if (!parsed) continue;
          setState({
            text: stripLeadingHeading(parsed.text),
            sourceUrl: parsed.sourceUrl || null,
            loading: false,
          });
          return;
        } catch (error) {
          if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) return;
        }
      }
      if (!controller.signal.aborted) {
        setState({ text: null, sourceUrl: null, loading: false });
      }
    })();
    return () => controller.abort();
  }, [enabled, id]);

  return state;
}

function isXStatusUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    return host === "x.com" || host === "twitter.com" || host === "mobile.twitter.com";
  } catch {
    return false;
  }
}

function useFullArticleText(url: string, enabled: boolean) {
  const [state, setState] = useState<{
    text: string | null;
    loading: boolean;
    failureKind: ReaderFailureKind | null;
    failureMessage: string | null;
  }>({
    text: null,
    loading: enabled,
    failureKind: null,
    failureMessage: null,
  });

  useEffect(() => {
    if (!enabled || !/^https?:\/\//i.test(url)) {
      setState({ text: null, loading: false, failureKind: null, failureMessage: null });
      return;
    }
    const controller = new AbortController();
    setState({ text: null, loading: true, failureKind: null, failureMessage: null });
    fetch(`${JINA_READER_ENDPOINT}${url}`, {
      signal: controller.signal,
      headers: {
        ...JINA_READER_HEADERS,
        "X-Retain-Images": "all",
      },
    })
      .then(async (response) => {
        const raw = await response.text();
        if (!response.ok) {
          const failure = classifyReaderHttpFailure(response.status, raw);
          throw Object.assign(new Error(failure.status), { readerFailure: failure });
        }
        return raw;
      })
      .then((raw) => {
        const text = cleanJinaArticle(raw);
        setState({
          text: text && !isReaderChrome(text) ? text : null,
          loading: false,
          failureKind: null,
          failureMessage: null,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const failure = classifyReaderThrow(error);
        setState({
          text: null,
          loading: false,
          failureKind: failure.kind,
          failureMessage: failure.message,
        });
      });
    return () => controller.abort();
  }, [enabled, url]);

  return state;
}

export function ArticleShareView({
  payload,
  openInTerminalHref,
}: {
  payload: ArticleSharePayload;
  openInTerminalHref?: string | null;
}) {
  // News and Substack shares often only snapshot a teaser. Fetch the full
  // article when the payload has no body; clustered wire stories stay as
  // summaries because they are not one page to extract.
  const needsFullText = articleShareNeedsReader(payload);
  const full = useFullArticleText(payload.url ?? "", needsFullText);
  const snapshot = articleShareBodySource(payload, full.text);
  const snapshotChars = snapshot.kind === "markdown"
    ? snapshot.text.length
    : snapshot.kind === "html"
      ? snapshot.html.length
      : 0;
  const filing = useCftcFilingText(payload.id, filingShareNeedsText(payload.id, snapshotChars));
  const source = filing.text
    ? articleShareBodySource(payload, filing.text)
    : snapshot;
  const fallbackNotice = readerFallbackNotice(full.failureKind, source.kind !== "empty");
  const archive = useShareArticleArchive(payload.url);
  const images = payload.imageUrls?.filter(Boolean).slice(0, 4) ?? [];
  const bodyDuplicatesTitle = source.kind === "markdown"
    && source.text.trim() === payload.title.trim();
  const showEmptyNotice = !full.loading
    && source.kind === "empty"
    && images.length === 0;

  const published = formatShareTimestamp(payload.publishedAt);
  const byline = payload.source || payload.publicationName || "";
  const tickers = articleTickers(payload.tickers);
  const originalUrl = payload.url || filing.sourceUrl || "";
  const footer = originalUrl
    ? <a href={originalUrl} target="_blank" rel="noreferrer noopener">view original</a>
    : null;

  return (
    <ShareShell
      tone="public"
      title={payload.title}
      footer={footer}
      openInTerminalHref={openInTerminalHref}
      onArchive={archive.archive}
      archiveEnabled={archive.enabled}
    >
      {tickers.length > 0 ? (
        <ul className="share-tickers">
          {tickers.map((ticker) => <li key={ticker}>{ticker}</li>)}
        </ul>
      ) : null}
      {byline || published ? (
        <p className="share-meta">
          {byline ? <span>Source: {byline}</span> : null}
          {byline && published ? <span className="share-meta-sep" aria-hidden="true">|</span> : null}
          {published ? <span>Publication Date: {published}</span> : null}
        </p>
      ) : null}
      {payload.subtitle ? <p className="share-subtitle">{payload.subtitle}</p> : null}

      {fallbackNotice ? <p className="share-note">{fallbackNotice}</p> : null}

      {source.kind === "html" ? <SanitizedHtmlBody html={source.html} /> : source.kind === "markdown" && !bodyDuplicatesTitle
        ? <MarkdownBody text={source.text} />
        : showEmptyNotice
          ? (
            <p className="share-note">
              {full.failureMessage
                ?? "No article text was included in this link."}
              {payload.url && full.failureMessage ? (
                <>
                  {" "}
                  <a href={payload.url} target="_blank" rel="noreferrer noopener">Open source</a>
                </>
              ) : null}
            </p>
          )
          : null}

      {images.length > 0 ? (
        <div className="share-images">
          {images.map((src) => (
            <img key={src} src={src} alt="" />
          ))}
        </div>
      ) : null}

      {full.loading || filing.loading ? (
        <div className="share-loading-body" role="status" aria-live="polite">Loading full article&hellip;</div>
      ) : null}

      {payload.items?.length ? (
        <>
          <p className="share-items-heading">Related coverage</p>
          <ul className="share-items">
            {payload.items.map((item, index) => (
              <li className="share-item" key={item.id || item.url || index}>
                <a className="share-item-title" href={item.url} target="_blank" rel="noreferrer noopener">
                  {item.title || item.url || "Related coverage"}
                </a>
                <span className="share-item-meta">
                  {[item.sourceName, formatShareTimestamp(item.publishedAt)]
                    .filter(Boolean)
                    .join(" ")}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </ShareShell>
  );
}
