import {
  DEFAULT_MAX_READ_IDS,
  markPersistedReadId,
  normalizePersistedReadIdState,
  removePersistedReadId,
  togglePersistedReadId,
  usePersistedReadIds,
  type PersistedReadIdAdapter,
} from "../../shared/read-state";

/** Template id of the Saved News pane; news footers deep-link to it. */
export const NEWS_SAVED_PANE_TEMPLATE_ID = "news-saved-pane";

export interface NewsSavedState {
  articleIds: string[];
}

const NEWS_SAVED_STATE_SCHEMA_VERSION = 1;
/** Own cap: bookmarks are user-curated, so they stay bounded but never share the read list. */
export const MAX_SAVED_ARTICLE_IDS = DEFAULT_MAX_READ_IDS;

const SAVED_STATE_KEY = "saved-articles";
const EMPTY_SAVED_STATE: NewsSavedState = { articleIds: [] };
const NEWS_SAVED_STATE_ADAPTER: PersistedReadIdAdapter<NewsSavedState> = {
  getIds: (state) => state.articleIds,
  withIds: (_state, articleIds) => ({ articleIds }),
  maxIds: MAX_SAVED_ARTICLE_IDS,
};

export function normalizeNewsSavedState(state: NewsSavedState): NewsSavedState {
  return normalizePersistedReadIdState(state, NEWS_SAVED_STATE_ADAPTER);
}

export function markNewsArticleSaved(
  state: NewsSavedState,
  articleId: string,
): NewsSavedState {
  return markPersistedReadId(state, articleId, NEWS_SAVED_STATE_ADAPTER);
}

export function unmarkNewsArticleSaved(
  state: NewsSavedState,
  articleId: string,
): NewsSavedState {
  return removePersistedReadId(state, articleId, NEWS_SAVED_STATE_ADAPTER);
}

export function toggleNewsArticleSaved(
  state: NewsSavedState,
  articleId: string,
): NewsSavedState {
  return togglePersistedReadId(state, articleId, NEWS_SAVED_STATE_ADAPTER);
}

/**
 * Saved-only view over a loaded article pool. Saved ids whose article has
 * scrolled out of every loaded query are simply absent — saving never
 * resurrects article bodies, it only remembers the id.
 */
export function filterSavedNewsArticles<T extends { id: string }>(
  articles: readonly T[],
  savedArticleIds: ReadonlySet<string>,
): T[] {
  if (savedArticleIds.size === 0) return [];
  return articles.filter((article) => savedArticleIds.has(article.id));
}

export function useNewsSavedState() {
  const {
    readIds: savedArticleIds,
    markRead: markArticleSaved,
    unmarkRead: unmarkArticleSaved,
    toggleRead: toggleArticleSaved,
  } = usePersistedReadIds({
    key: SAVED_STATE_KEY,
    fallback: EMPTY_SAVED_STATE,
    schemaVersion: NEWS_SAVED_STATE_SCHEMA_VERSION,
    adapter: NEWS_SAVED_STATE_ADAPTER,
  });
  return { savedArticleIds, markArticleSaved, unmarkArticleSaved, toggleArticleSaved };
}
