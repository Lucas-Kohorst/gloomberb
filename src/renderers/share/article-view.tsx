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
  preferredArticleBody,
  readerFallbackNotice,
  type ReaderFailureKind,
  JINA_READER_ENDPOINT,
  JINA_READER_HEADERS,
} from "../../plugins/builtin/shared/jina-article-text";
import { MarkdownBody, SanitizedHtmlBody } from "./rich-text";
import { ShareShell, formatShareTimestamp } from "./shell";

export { preferredArticleBody };

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
      headers: JINA_READER_HEADERS,
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
  const embedded = payload.bodyHtml?.trim() || "";
  const summary = payload.summary?.trim() || payload.previewText?.trim() || "";
  // Substack shares embed the body, and clustered wire stories are summaries of
  // other stories rather than one page to extract. Only a bare news link needs
  // the reader.
  const needsFullText = !embedded
    && payload.type === "news"
    && !payload.items?.length
    && !!payload.url;
  const full = useFullArticleText(payload.url, needsFullText);
  const body = preferredArticleBody(summary, full.text);
  const fallbackNotice = readerFallbackNotice(full.failureKind, !!body.trim());

  const published = formatShareTimestamp(payload.publishedAt);
  const source = payload.source || payload.publicationName || "";
  const footer = (
    <>
      {[source, published].filter(Boolean).join(" · ")}
      {payload.url ? (
        <>
          {source || published ? " · " : null}
          <a href={payload.url} target="_blank" rel="noreferrer noopener">view original</a>
        </>
      ) : null}
    </>
  );

  return (
    <ShareShell title={payload.title} footer={footer} openInTerminalHref={openInTerminalHref}>
      {payload.subtitle ? <p className="share-subtitle">{payload.subtitle}</p> : null}

      {fallbackNotice ? <p className="share-note">{fallbackNotice}</p> : null}

      {embedded ? <SanitizedHtmlBody html={embedded} /> : body
        ? <MarkdownBody text={body} />
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
            {payload.items.map((item) => (
              <li className="share-item" key={item.id}>
                <a className="share-item-title" href={item.url} target="_blank" rel="noreferrer noopener">
                  {item.title}
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
