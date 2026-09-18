import { useCallback, useMemo, useRef, useState } from "react";
import { usePaneFooter, type PaneListSearchProps } from "../../../../../components";
import type { NewsArticle } from "../../../../../news/types";
import { useShortcut } from "../../../../../react/input";
import type { InputRenderable } from "../../../../../ui";
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
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((current) => current + 1);
  }, []);
  const blurSearch = useCallback(() => {
    setSearchFocused(false);
  }, []);

  const filteredArticles = useMemo(
    () => filterNewsArticles(articles, searchQuery),
    [articles, searchQuery],
  );

  usePaneFooter(`${options.registrationId}:search`, () => ({
    order: -1,
    hints: [paneSearchHint(focusSearch)],
  }), [focusSearch]);

  useShortcut((event) => {
    if (!options.focused || searchFocused) return;
    if (event.name === "/") {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
    }
  }, { enabled: options.focused && !searchFocused });

  const handleRootKeyDown = useCallback((
    event: { name?: string; preventDefault?: () => void; stopPropagation?: () => void },
  ) => {
    if (event.name !== "/") return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    focusSearch();
    return true;
  }, [focusSearch]);

  const search: PaneListSearchProps = {
    value: searchQuery,
    active: searchFocused,
    focusToken: searchFocusToken,
    inputRef: searchInputRef,
    placeholder: options.placeholder ?? NEWS_LIST_SEARCH_PLACEHOLDER,
    debounceMs: 80,
    onFocus: focusSearch,
    onBlur: blurSearch,
    onNavigateDown: blurSearch,
    onQueryChange: setSearchQuery,
  };

  return {
    searchQuery,
    searchFocused,
    filteredArticles,
    search,
    handleRootKeyDown,
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
