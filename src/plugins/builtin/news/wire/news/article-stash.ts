import type { NewsArticle } from "../../../../../news/types";

const stash = new Map<string, NewsArticle>();

export function stashNewsArticle(article: NewsArticle): void {
  stash.set(article.id, article);
}

export function getStashedNewsArticle(articleId: string): NewsArticle | null {
  return stash.get(articleId) ?? null;
}
