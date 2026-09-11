import { Box, type InputRenderable } from "../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PaneProps } from "../../../types/plugin";
import {
  EmptyState,
  FeedDataTableStackView,
  InputSearchBar,
  Spinner,
  useUpdatedAgo,
  type FeedDataTableItem,
} from "../../../components";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import type { NewsArticle } from "../../../news/types";
import { useDebouncedPluginPaneState, usePluginPaneState } from "../../runtime";
import { usePaneSettingValue } from "../../../state/app/context";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { usePopOutNewsArticle } from "../news/wire/news/pop-out";
import { CommentLettersClient } from "./client";
import {
  COMMENT_LETTERS_PLUGIN_ID,
  severityTag,
  type CommentLetter,
} from "./types";

const SEARCH_DEBOUNCE_MS = 350;
const REFRESH_INTERVAL_MINUTES = 30;
const LETTER_LIST_LIMIT = 50;

const trimSearchValue = (value: string) => value.trim();

function formatTime(date: Date): string {
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return "—";
  return date.toISOString().slice(0, 10);
}

/** EDGAR full-text search only covers 2001+; say so instead of failing open. */
function listLetters(options: Parameters<CommentLettersClient["listCommentLetters"]>[0]) {
  return new CommentLettersClient().listCommentLetters(options);
}

function buildDetailMeta(letter: CommentLetter): string[] {
  const meta = [
    `${letter.form} · ${severityTag(letter.severity)}`,
    letter.companyName,
    letter.ticker,
    formatTime(letter.filingDate),
  ].filter((value): value is string => !!value);
  if (letter.severityReasons.length > 0) {
    meta.push(`Signals: ${letter.severityReasons.slice(0, 4).join(", ")}`);
  }
  return meta;
}

function buildDetailBody(letter: CommentLetter): string {
  const lines = [
    `**Form:** ${letter.form}`,
    `**Filed:** ${formatTime(letter.filingDate)}`,
    `**Severity:** ${severityTag(letter.severity)} (score ${letter.severityScore})`,
  ];
  if (letter.description) lines.push(`**Description:** ${letter.description}`);
  if (letter.severityReasons.length > 0) {
    lines.push("", "Matched signals:", ...letter.severityReasons.map((reason) => `- ${reason}`));
  }
  lines.push(
    "",
    "Severity is a keyword heuristic — open the filing to judge the exchange yourself.",
  );
  return lines.join("\n");
}

function toFeedItems(letters: CommentLetter[]): FeedDataTableItem[] {
  return letters.map((letter) => ({
    id: letter.id,
    eyebrow: severityTag(letter.severity),
    title: letter.companyName
      ? `${letter.companyName}${letter.ticker ? ` (${letter.ticker})` : ""} · ${letter.description || letter.form}`
      : letter.description || letter.form,
    timestamp: letter.filingDate,
    detailTitle: `${letter.form} · ${letter.companyName ?? letter.cik}`,
    detailMeta: buildDetailMeta(letter),
    detailBody: buildDetailBody(letter),
  }));
}

function letterToArticle(letter: CommentLetter): NewsArticle {
  const url = letter.primaryDocumentUrl ?? letter.filingUrl;
  return {
    id: `comment-letter:${letter.id}`,
    title: `${letter.form} · ${letter.companyName ?? letter.cik}`,
    url,
    source: "SEC",
    publishedAt: letter.filingDate,
    summary: letter.description || `${letter.form} · ${letter.companyName ?? letter.cik}`,
    topic: "filing",
    topics: ["filing", "sec", "comment-letter"],
    sectors: [],
    categories: ["SEC", letter.form],
    tickers: letter.ticker ? [letter.ticker] : [],
    scores: { importance: 0, urgency: 0, marketImpact: 0, novelty: 0, confidence: 0 },
    isBreaking: false,
    isDeveloping: false,
    importance: 0,
    origin: "comment-letters",
    body: buildDetailBody(letter),
  };
}

export function CommentLettersPane({ width, height, focused }: PaneProps) {
  const [storedQuery] = usePaneSettingValue("query", "");
  const initialQuery = String(storedQuery ?? "").trim();
  const [query, setQuery] = usePluginPaneState("query", initialQuery);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);

  const [letters, setLetters] = useState<CommentLetter[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useDebouncedPluginPaneState<number>("selectedIdx", 0);
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback((nextQuery: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("loading");
    setError(null);
    listLetters({ query: nextQuery, count: LETTER_LIST_LIMIT })
      .then((page) => {
        if (abortRef.current !== controller) return;
        setLetters(page);
        setStatus("loaded");
        setLastUpdated(Date.now());
      })
      .catch((loadError) => {
        if (abortRef.current !== controller) return;
        if (loadError instanceof Error && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setLetters([]);
        setStatus("error");
      });
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      load(query);
    }, query.trim() ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timeoutId);
  }, [load, query]);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (letters.length > 0 && selectedIdx >= letters.length) {
      setSelectedIdx(Math.max(0, letters.length - 1));
    }
  }, [selectedIdx, setSelectedIdx, letters.length]);

  const selectedLetter = letters[selectedIdx] ?? null;
  const openLetter = openItemId
    ? letters.find((letter) => letter.id === openItemId) ?? null
    : null;
  const detailLetter = openLetter ?? selectedLetter;
  const detailUrl = detailLetter?.primaryDocumentUrl ?? detailLetter?.filingUrl ?? null;

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((current) => current + 1);
  }, []);
  const blurSearch = useCallback(() => {
    setSearchFocused(false);
  }, []);
  const updateQuery = useCallback(
    (nextQuery: string) => {
      setQuery(nextQuery);
      setSelectedIdx(0);
      setOpenItemId(null);
    },
    [setQuery, setSelectedIdx],
  );
  const refresh = useCallback(() => {
    load(query);
  }, [load, query]);

  useShortcut((event) => {
    if (!focused || openItemId) return;
    if (searchFocused) {
      if (isPlainKey(event, "escape")) {
        event.stopPropagation?.();
        event.preventDefault?.();
        setSearchFocused(false);
        updateQuery("");
      }
      return;
    }
    if (event.targetEditable) return;
    if (isPlainKey(event, "/")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      focusSearch();
      return;
    }
    if (isPlainKey(event, "r")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      refresh();
    }
  }, { allowEditable: true, enabled: focused });

  const loading = status === "loading" && letters.length === 0;
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  const items = useMemo(() => toFeedItems(letters), [letters]);
  const popOutArticle = usePopOutNewsArticle(() => setOpenItemId(null));
  useAutoRefresh(
    status === "loaded" ? lastUpdated : null,
    refresh,
    REFRESH_INTERVAL_MINUTES,
  );

  usePaneStatusLinkFooter({
    registrationId: COMMENT_LETTERS_PLUGIN_ID,
    focused,
    url: error ? null : detailUrl,
    source: detailLetter ? detailLetter.companyName ?? detailLetter.form : undefined,
    label: "filing",
    loading,
    error,
    info: updatedAgo
      ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
      : [],
    showOpenHint: !error && !!detailUrl,
    hints: [
      { id: "search", key: "/", label: "search", onPress: focusSearch },
      { id: "refresh", key: "r", label: "efresh", onPress: refresh },
      ...(detailLetter && !error
        ? [{
          id: "pop-out",
          key: "p",
          label: "op out",
          onPress: () => {
            popOutArticle(letterToArticle(detailLetter));
          },
        }]
        : []),
    ],
  });

  const handleRootKeyDown = useCallback(
    (event: {
      name?: string;
      preventDefault?: () => void;
      stopPropagation?: () => void;
    }, context: { selectedIndex: number; itemCount: number }) => {
      if (context.selectedIndex <= 0 && isPlainArrowUp(event)) {
        stopSearchFocusNavigation(event);
        focusSearch();
        return true;
      }
      if (event.name === "/") {
        event.preventDefault?.();
        event.stopPropagation?.();
        focusSearch();
        return true;
      }
      if (event.name === "r") {
        event.preventDefault?.();
        event.stopPropagation?.();
        refresh();
        return true;
      }
      return false;
    },
    [focusSearch, refresh],
  );

  const rootBefore = (
    <InputSearchBar
      value={query}
      focused={focused && !openItemId}
      active={searchFocused}
      width={width}
      focusToken={searchFocusToken}
      inputRef={searchInputRef}
      placeholder="company or topic"
      debounceMs={SEARCH_DEBOUNCE_MS}
      normalizeValue={trimSearchValue}
      onFocus={focusSearch}
      onBlur={blurSearch}
      onNavigateDown={blurSearch}
      onQueryChange={updateQuery}
    />
  );

  if (loading) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner
            label={
              query.trim()
                ? `Searching comment letters for ${query.trim()}...`
                : "Loading comment letters..."
            }
          />
        </Box>
      </Box>
    );
  }

  if (error && letters.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center" padding={1}>
          <EmptyState
            title="Comment letters unavailable."
            message={error}
            hint="Press r to retry."
          />
        </Box>
      </Box>
    );
  }

  return (
    <FeedDataTableStackView
      width={width}
      height={height}
      focused={focused && !searchFocused}
      rootBefore={rootBefore}
      items={items}
      selectedIdx={selectedIdx}
      onSelect={setSelectedIdx}
      onOpenItemIdChange={setOpenItemId}
      onRootKeyDown={handleRootKeyDown}
      onPopOut={(item) => {
        const letter = letters.find((entry) => entry.id === item.id) ?? detailLetter;
        if (letter) popOutArticle(letterToArticle(letter));
      }}
      sourceLabel="Severity"
      titleLabel="Letter"
      markdown
      emptyStateTitle={
        query.trim()
          ? `No comment letters match ${query.trim()}.`
          : "No recent comment letters."
      }
      emptyStateHint="Press / to search…"
    />
  );
}
