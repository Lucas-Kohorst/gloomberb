import { createShare } from "./api";
import {
  encodeArticleSharePayload,
  MAX_TABLE_ROWS,
  parseSharePayload,
  type ArticleSharePayload,
  type SharePayload,
  type TableSharePayload,
} from "./payload";
import { buildInlineArticleShareUrl, publicShareUrl } from "./routes";

type ShareCreator = typeof createShare;

export async function publishShare(payload: SharePayload, create: ShareCreator = createShare): Promise<string> {
  const { id } = await create(payload);
  return publicShareUrl(id);
}

/** Rich articles retain their snapshot in the supported inline reader. */
export async function publishArticleShare(
  article: ArticleSharePayload,
  create: ShareCreator = createShare,
): Promise<string> {
  const inlineUrl = () => buildInlineArticleShareUrl(encodeArticleSharePayload(article));
  if (article.bodyHtml || article.imageUrls?.length || article.items?.length) return inlineUrl();
  const text = [
    article.subtitle,
    [article.source || article.publicationName, article.publishedAt].filter(Boolean).join(" · "),
    article.summary || article.previewText,
  ].filter(Boolean).join("\n\n");
  try {
    return await publishShare({
      kind: "article",
      data: { title: article.title, text, ...(article.url ? { sourceUrl: article.url } : {}) },
    }, create);
  } catch {
    return inlineUrl();
  }
}

/** Preserve displayed cell values when crossing into the stored table contract. */
export function tableSnapshotSharePayload(snapshot: TableSharePayload): SharePayload {
  if (snapshot.rows.length > MAX_TABLE_ROWS || (snapshot.truncatedFrom ?? 0) > snapshot.rows.length) {
    throw new Error(`Filter this table to ${MAX_TABLE_ROWS} rows or fewer before sharing.`);
  }
  const hasUrls = snapshot.rows.some((row) => row.url);
  const columns = snapshot.columns.map((column, index) => ({ key: `c${index}`, label: column.label }));
  if (hasUrls) columns.push({ key: "source", label: "Source" });
  const payload = parseSharePayload({
    kind: "table",
    data: {
      title: snapshot.title,
      columns,
      rows: snapshot.rows.map((row) => Object.fromEntries([
        ...snapshot.columns.map((_, index) => [`c${index}`, row.cells[index]?.text ?? ""]),
        ...(hasUrls ? [["source", row.url ?? ""]] : []),
      ])),
    },
  });
  if (!payload) throw new Error("This table exceeds the share service's column or size limits.");
  return payload;
}
