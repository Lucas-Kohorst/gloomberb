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
import { MarkdownBody, SanitizedHtmlBody } from "./rich-text";
import { ShareHeading, ShareShell, formatShareTimestamp, type ShareMetaEntry } from "./shell";

const READER_ENDPOINT = "https://r.jina.ai/";

/**
 * The reader prefixes responses with `Title:` / `URL Source:` / `Published
 * Time:` lines. The page already shows that metadata above the body.
 */
function stripReaderPreamble(raw: string): string {
  const text = raw.trim();
  if (!text.startsWith("Title:")) return text;
  const marker = text.match(/^Markdown Content:[ \t]*$/m);
  if (marker?.index == null) return text;
  return text.slice(marker.index + marker[0].length).trim();
}

/**
 * The reader does not always return an article. Paywalls, consent walls, and
 * dead links come back as a short landing page, which would replace a summary
 * the share payload already carried with something worse. Length is a crude
 * signal but the right one here: extraction only wins when it actually got more.
 */
export function preferredArticleBody(summary: string, fullText: string | null): string {
  if (!fullText) return summary;
  if (!summary) return fullText;
  return fullText.length > summary.length ? fullText : summary;
}

function useFullArticleText(url: string, enabled: boolean) {
  const [state, setState] = useState<{ text: string | null; loading: boolean }>({
    text: null,
    loading: enabled,
  });

  useEffect(() => {
    if (!enabled || !/^https?:\/\//i.test(url)) {
      setState({ text: null, loading: false });
      return;
    }
    const controller = new AbortController();
    setState({ text: null, loading: true });
    fetch(`${READER_ENDPOINT}${url}`, {
      signal: controller.signal,
      headers: { Accept: "text/plain" },
    })
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error(""))))
      .then((raw) => setState({ text: stripReaderPreamble(raw), loading: false }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ text: null, loading: false });
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

  const published = formatShareTimestamp(payload.publishedAt);
  const meta: ShareMetaEntry[] = [
    { value: payload.source || payload.publicationName || "" },
    ...(published ? [{ label: "Published", value: published }] : []),
    ...(payload.url ? [{ value: "View original", href: payload.url }] : []),
  ];

  return (
    <ShareShell openInTerminalHref={openInTerminalHref} openInTerminalLabel="Open in terminal">
      <ShareHeading title={payload.title} subtitle={payload.subtitle} meta={meta} />

      {embedded ? <SanitizedHtmlBody html={embedded} /> : body
        ? <MarkdownBody text={body} />
        : !full.loading
          ? <p className="share-note">No article text was included in this link.</p>
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
