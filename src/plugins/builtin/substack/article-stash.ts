import type { SubstackArticleSummary } from "./types";

const stash = new Map<string, SubstackArticleSummary>();

export function stashSubstackArticle(article: SubstackArticleSummary): void {
  stash.set(article.id, article);
}

export function getStashedSubstackArticle(articleId: string): SubstackArticleSummary | null {
  return stash.get(articleId) ?? null;
}
