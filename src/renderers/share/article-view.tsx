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
  looksLikeHtmlDocument,
  preferredArticleBody,
  readableArticleText,
  readerFallbackNotice,
  type ReaderFailureKind,
  JINA_READER_ENDPOINT,
  JINA_READER_HEADERS,
} from "../../plugins/builtin/shared/jina-article-text";
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
  return text ? { kind: "markdown", text } : { kind: "empty" };
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
  return payload.type === "news" || payload.type === "substack";
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
      .then((raw) => setState({
        text: cleanJinaArticle(raw),
        loading: false,
        failureKind: null,
        failureMessage: null,
      }))
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
  const source = articleShareBodySource(payload, full.text);
  const fallbackNotice = readerFallbackNotice(full.failureKind, source.kind !== "empty");
  const archive = useShareArticleArchive(payload.url);

  const published = formatShareTimestamp(payload.publishedAt);
  const byline = payload.source || payload.publicationName || "";
  const footer = (
    <>
      {[byline, published].filter(Boolean).join(" · ")}
      {payload.url ? (
        <>
          {byline || published ? " · " : null}
          <a href={payload.url} target="_blank" rel="noreferrer noopener">view original</a>
        </>
      ) : null}
    </>
  );

  return (
    <ShareShell
      title={payload.title}
      footer={footer}
      openInTerminalHref={openInTerminalHref}
      onArchive={archive.archive}
      archiveEnabled={archive.enabled}
    >
      {payload.subtitle ? <p className="share-subtitle">{payload.subtitle}</p> : null}

      {fallbackNotice ? <p className="share-note">{fallbackNotice}</p> : null}

      {source.kind === "html" ? <SanitizedHtmlBody html={source.html} /> : source.kind === "markdown"
        ? <MarkdownBody text={source.text} />
        : !full.loading
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

      {full.loading ? (
        <div className="share-loading-body">Loading full article&hellip;</div>
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
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </ShareShell>
  );
}
