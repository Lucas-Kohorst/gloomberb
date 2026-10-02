import { useMemo, useState } from "react";
import { usePaneFooter, usePaneListSearch } from "../../../../../components";
import type { NewsArticle } from "../../../../../news/types";
import { paneSearchHint } from "../../../shared/pane-footer";
import { filterNewsArticles } from "../filter-articles";

export const NEWS_LIST_SEARCH_PLACEHOLDER = "filter headlines, sources, tickers…";

/**
 * In-pane `/` search for news list panes. Registers `paneSearchHint`, binds `/`,
 * and returns PaneListChrome search props so top/feed/industry/breaking match
 * firehose and RSS without advertising per-pane `[r]efresh`.
 */
export function useNewsListSearch<T extends NewsArticle>(
  articles: readonly T[],
  options: {
    registrationId: string;
    focused: boolean;
    placeholder?: string;
  },
) {
  const [searchQuery, setSearchQuery] = useState("");
  const { search, searchFocused, focusSearch, handleSearchKey } = usePaneListSearch({
    focused: options.focused,
    value: searchQuery,
    onQueryChange: setSearchQuery,
    placeholder: options.placeholder ?? NEWS_LIST_SEARCH_PLACEHOLDER,
  });

  const filteredArticles = useMemo(
    () => filterNewsArticles(articles, searchQuery),
    [articles, searchQuery],
  );

  usePaneFooter(`${options.registrationId}:search`, () => ({
    order: -1,
    hints: [paneSearchHint(focusSearch)],
  }), [focusSearch]);

  return {
    searchQuery,
    searchFocused,
    filteredArticles,
    search,
    handleRootKeyDown: handleSearchKey,
  };
}

export function newsListSearchEmptyCopy(searchQuery: string, fallback: {
  title: string;
  hint: string;
}): { title: string; hint: string } {
  if (!searchQuery.trim()) return fallback;
  return {
    title: "No matching articles.",
    hint: "Clear search or press r to refresh.",
  };
}
