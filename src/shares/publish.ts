import { createHostedShare, createShare, lookupNewsShareId, registerArticleSlug, registerNewsShare } from "./api";
import { slugifyArticleTitle } from "../utils/slugify";
import {
  articleShareStoreData,
  encodeArticleSharePayload,
  MAX_TABLE_ROWS,
  parseSharePayload,
  type ArticleSharePayload,
  type SharePayload,
  type TableSharePayload,
} from "./payload";
import {
  articleShareSlug,
  buildArticleSlugUrl,
  buildInlineArticleShareUrl,
  buildShortShareUrl,
  hashArticleId,
  isCanonicalNewsId,
  isStoredShareId,
  publicArticleSlugUrl,
  publicNewsUrl,
  publicShareUrl,
} from "./routes";

type ShareCreator = typeof createShare;

export interface NewsShareIndex {
  lookup(articleId: string): Promise<string | null>;
  register(articleId: string, shareId: string): Promise<boolean>;
}

const hostedNewsIndex: NewsShareIndex = {
  lookup: lookupNewsShareId,
  register: registerNewsShare,
};

const noopNewsIndex: NewsShareIndex = {
  lookup: async () => null,
  register: async () => false,
};

export interface ArticleSlugIndex {
  register(slug: string, articleId: string, shareId: string): Promise<boolean>;
}

const hostedSlugIndex: ArticleSlugIndex = {
  register: (slug, articleId, shareId) => registerArticleSlug(slug, articleId, shareId),
};

const noopSlugIndex: ArticleSlugIndex = {
  register: async () => false,
};

type HostedShareCreator = (payload: SharePayload) => Promise<{ id: string; slug?: string } | null>;

const hostedShareCreator: HostedShareCreator = (payload) => createHostedShare(payload);
const noopHostedShareCreator: HostedShareCreator = async () => null;

function publicUrlForShareId(id: string): string {
  return isStoredShareId(id) ? publicShareUrl(id) : buildShortShareUrl(id);
}

export async function publishShare(payload: SharePayload, create: ShareCreator = createShare): Promise<string> {
  const { id } = await create(payload);
  return publicShareUrl(id);
}

/**
 * Prefer a human-readable `/article/{title}--{hash}` page when the slug index
 * can be written (Cloud or unsigned hosted KV). `/news/{articleId}` stays the
 * reuse URL for stories already indexed.
 *
 * Inline `/article?a=` is only the last resort when Cloud and hosted KV both
 * reject, or the payload will not fit the stored envelope.
 */
export async function publishArticleShare(
  article: ArticleSharePayload,
  create: ShareCreator = createShare,
  newsIndex: NewsShareIndex = create === createShare ? hostedNewsIndex : noopNewsIndex,
  hostedCreate: HostedShareCreator = create === createShare ? hostedShareCreator : noopHostedShareCreator,
  slugIndex: ArticleSlugIndex = create === createShare ? hostedSlugIndex : noopSlugIndex,
): Promise<string> {
  const inlineUrl = () => buildInlineArticleShareUrl(encodeArticleSharePayload(article));
  const articleId = article.id.trim();
  const canonical = isCanonicalNewsId(articleId);
  if (canonical && await newsIndex.lookup(articleId)) return publicNewsUrl(articleId);
  const candidates = [
    articleShareStoreData(article),
    articleShareStoreData({ ...article, bodyHtml: undefined }),
  ];
  for (const data of candidates) {
    const envelope = parseSharePayload({ kind: "article", data });
    if (!envelope) continue;
    try {
      const { id } = await create(envelope);
      const newsRegistered = canonical && await newsIndex.register(articleId, id);
      if (canonical) {
        try {
          const titleSlug = slugifyArticleTitle(article.title);
          const idHash = await hashArticleId(articleId);
          const fullSlug = articleShareSlug(titleSlug, idHash);
          if (await slugIndex.register(fullSlug, articleId, id)) {
            return buildArticleSlugUrl(titleSlug, idHash);
          }
        } catch {
          // Never return a slug URL that was not written to the index.
        }
      }
      if (newsRegistered) return publicNewsUrl(articleId);
      return publicUrlForShareId(id);
    } catch {
      // Cloud auth/size/network: try a smaller body, then hosted KV, then inline.
    }
  }
  for (const data of candidates) {
    const envelope = parseSharePayload({ kind: "article", data });
    if (!envelope) continue;
    const hosted = await hostedCreate(envelope);
    if (!hosted) continue;
    if (hosted.slug) {
      try {
        return publicArticleSlugUrl(hosted.slug);
      } catch {
        // Hosted wrote a snapshot but an unusable slug; fall through to /s/{id}.
      }
    }
    return publicUrlForShareId(hosted.id);
  }
  return inlineUrl();
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
