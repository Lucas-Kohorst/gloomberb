import { cleanJinaArticle } from "../plugins/builtin/shared/jina-article-text";
import type { SharePayload } from "./payload";
import { articleShareFromStored } from "./payload";

export function escapeShareHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface ShareDocumentMeta {
  title: string;
  description?: string;
  /** Absolute page URL. Twitter will not unfurl a relative one. */
  url?: string;
  /** Absolute https image. Articles use the first snapshot image. */
  image?: string;
}

function httpsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function clip(value: string | undefined): string | undefined {
  const text = value
    ?.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]+/g, "")
    .replace(/^#+\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 240) : undefined;
}

/**
 * Card copy for the link itself. A chart names its series, a list says it
 * opens in Gloom, and an article uses the story plus its image when it has one.
 */
export function shareEmbedFromPayload(payload: SharePayload, pageUrl?: string): ShareDocumentMeta {
  const url = httpsUrl(pageUrl);
  if (payload.kind === "article") {
    const article = articleShareFromStored(payload.data);
    const image = article.imageUrls?.map((src) => httpsUrl(src)).find((src): src is string => !!src);
    const body = cleanJinaArticle(article.summary || article.previewText || article.subtitle || "");
    return {
      title: article.title,
      description: clip(body || article.summary || article.previewText || article.subtitle),
      url,
      image,
    };
  }
  if (payload.kind === "chart") {
    const names = payload.data.series.map((series) => series.name.trim()).filter(Boolean).slice(0, 4);
    return {
      title: payload.data.title,
      description: names.length ? `${names.join(", ")}. Chart on Gloom.` : "Chart on Gloom.",
      url,
    };
  }
  if (payload.kind === "table") {
    return {
      title: payload.data.title,
      description: "This list opens in Gloom.",
      url,
    };
  }
  return {
    title: payload.data.title,
    description: clip(payload.data.description) ?? "Open this view in Gloom.",
    url,
  };
}

export function injectShareDocumentMeta(
  html: string,
  meta: ShareDocumentMeta,
  options?: { allowPreview?: boolean },
): string {
  const title = escapeShareHtml(meta.title.trim() || "Gloom");
  const description = escapeShareHtml(clip(meta.description) ?? "");
  const url = httpsUrl(meta.url);
  const image = httpsUrl(meta.image);
  const card = image ? "summary_large_image" : "summary";
  const tags = [
    `<meta property="og:site_name" content="Gloom" />`,
    `<meta property="og:title" content="${title}" />`,
    description ? `<meta property="og:description" content="${description}" />` : "",
    `<meta property="og:type" content="article" />`,
    url ? `<meta property="og:url" content="${escapeShareHtml(url)}" />` : "",
    image ? `<meta property="og:image" content="${escapeShareHtml(image)}" />` : "",
    `<meta name="twitter:card" content="${card}" />`,
    `<meta name="twitter:title" content="${title}" />`,
    description ? `<meta name="twitter:description" content="${description}" />` : "",
    image ? `<meta name="twitter:image" content="${escapeShareHtml(image)}" />` : "",
  ].filter(Boolean).join("");
  const withTags = html
    .replace(/<title>[^<]*<\/title>/, () => `<title>${title}</title>`)
    .replace("</head>", () => `${tags}</head>`);
  if (!options?.allowPreview) return withTags;
  return withTags.replace(
    /<meta name="robots" content="noindex"\s*\/?>/,
    `<meta name="robots" content="max-image-preview:large" />`,
  );
}
