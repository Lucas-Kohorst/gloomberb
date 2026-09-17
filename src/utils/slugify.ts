export function slugifyName(name: string, fallbackPrefix: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `${fallbackPrefix}-${Date.now()}`;
}

const ARTICLE_TITLE_SLUG_MAX_LENGTH = 60;

/** URL-safe title segment for `/article/{slug}--{hash}` share links. */
export function slugifyArticleTitle(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) return "article";
  return slug.slice(0, ARTICLE_TITLE_SLUG_MAX_LENGTH).replace(/-$/g, "") || "article";
}
