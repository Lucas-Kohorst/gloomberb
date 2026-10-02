import { Box } from "../../../ui";
import { useCallback, useMemo, useState } from "react";
import type { PaneProps } from "../../../types/plugin";
import {
  FeedDataTableStackView,
  PaneListChrome,
  usePaneListSearch,
  PaneStatusBody,
  useUpdatedAgo,
  type FeedDataTableItem,
} from "../../../components";
import { useAsyncResource } from "../../../react/async-resource";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import type { NewsArticle } from "../../../news/types";
import { useDebouncedPluginPaneState, usePluginPaneState } from "../../runtime";
import { usePaneSettingValue } from "../../../state/app/context";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { pollFooterTrailingInfo, useFeedPollInterval } from "../shared/feed-poll-interval";
import { usePopOutNewsArticle } from "../news/wire/news/pop-out";
import { newsArticleSharePayload, useCopyShareLink } from "../shared/article-share";
import { CommentLettersClient } from "./client";
import {
  COMMENT_LETTERS_PLUGIN_ID,
  severityTag,
  type CommentLetter,
} from "./types";

const EMPTY_ITEMS: CommentLetter[] = [];

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
  return [
    `${severityTag(letter.severity)} (score ${letter.severityScore})`,
    letter.ticker,
    formatTime(letter.filingDate),
  ].filter((value): value is string => !!value);
}

function buildLetterText(letter: CommentLetter): string {
  const lines: string[] = [];
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

function buildDetailBody(letter: CommentLetter): string {
  return [
    `**Form:** ${letter.form}`,
    `**Filed:** ${formatTime(letter.filingDate)}`,
    `**Severity:** ${severityTag(letter.severity)} (score ${letter.severityScore})`,
    "",
    buildLetterText(letter),
  ].join("\n");
}

function toFeedItems(letters: CommentLetter[]): FeedDataTableItem[] {
  return letters.map((letter) => ({
    id: letter.id,
    eyebrow: severityTag(letter.severity),
    title: letter.companyName
      ? `${letter.companyName}${letter.ticker ? ` (${letter.ticker})` : ""} · ${letter.description || letter.form}`
      : letter.description || letter.form,
    timestamp: letter.filingDate,
    timestampKind: "date",
    detailTitle: `${letter.form} · ${letter.companyName ?? letter.cik}`,
    detailMeta: buildDetailMeta(letter),
    detailBody: buildLetterText(letter),
  }));
}

function letterToArticle(letter: CommentLetter): NewsArticle {
  const url = letter.primaryDocumentUrl ?? letter.filingUrl;
  return {
    id: `comment-letter:${letter.id}`,
    title: `${letter.form} ${letter.companyName ?? letter.cik}`,
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

  const [selectedId, setSelectedId] = useDebouncedPluginPaneState<string | null>("selectedId", null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  const loader = useCallback(
    () => listLetters({ query, count: LETTER_LIST_LIMIT }),
    [query],
  );
  const { data, loading: refreshing, error, updatedAt: lastUpdated, reload: refresh } = useAsyncResource(loader);
  const letters = data ?? EMPTY_ITEMS;

  const selectedLetter = letters.find((item) => item.id === selectedId) ?? letters[0] ?? null;
  const openLetter = openItemId
    ? letters.find((letter) => letter.id === openItemId) ?? null
    : null;
  const detailLetter = openLetter ?? selectedLetter;
  const detailUrl = detailLetter?.primaryDocumentUrl ?? detailLetter?.filingUrl ?? null;

  const updateQuery = useCallback(
    (nextQuery: string) => {
      setQuery(nextQuery);
      setSelectedId(null);
      setOpenItemId(null);
    },
    [setQuery, setSelectedId],
  );
  const { search, searchFocused, focusSearch, handleSearchKey } = usePaneListSearch({
    focused: focused && !openItemId,
    value: query,
    onQueryChange: updateQuery,
    placeholder: "company or topic",
    debounceMs: SEARCH_DEBOUNCE_MS,
    normalizeValue: trimSearchValue,
  });

  useShortcut((event) => {
    if (!focused || openItemId || searchFocused || event.targetEditable) return;
    if (isPlainKey(event, "r")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      refresh();
    }
  }, { allowEditable: true, enabled: focused });

  const loading = refreshing && letters.length === 0;
  const updatedAgo = useUpdatedAgo(lastUpdated);
  const items = useMemo(() => toFeedItems(letters), [letters]);
  const popOutArticle = usePopOutNewsArticle(() => setOpenItemId(null));
  const copyShareLink = useCopyShareLink();
  const shareSelected = useCallback(() => {
    if (!detailLetter) return;
    void copyShareLink(newsArticleSharePayload(letterToArticle(detailLetter)));
  }, [copyShareLink, detailLetter]);
  const poll = useFeedPollInterval({ overrideConfigKey: "pollIntervalMinutes", defaultMinutes: REFRESH_INTERVAL_MINUTES });
  useAutoRefresh(
    lastUpdated,
    refresh, poll.intervalMinutes,
  );

  usePaneStatusLinkFooter({
    registrationId: COMMENT_LETTERS_PLUGIN_ID,
    focused,
    url: detailUrl,
    loading: refreshing,
    error,
    info: updatedAgo
      ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
      : [],
    trailingInfo: [...pollFooterTrailingInfo(!openItemId, poll.segment)],
    showOpenHint: !!detailUrl,
    hints: [
      ...(!openItemId ? [{ id: "search", key: "/", label: "search", onPress: focusSearch }] : []),
      ...(detailLetter
        ? [{
          id: "pop-out",
          key: "p",
          label: "op out",
          onPress: () => {
            popOutArticle(letterToArticle(detailLetter));
          },
        }, {
          id: "share",
          key: "s",
          label: "hare",
          onPress: shareSelected,
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
      if (handleSearchKey(event)) return true;
      if (event.name === "r") {
        event.preventDefault?.();
        event.stopPropagation?.();
        refresh();
        return true;
      }
      if (event.name === "s" || event.name === "y") {
        event.preventDefault?.();
        event.stopPropagation?.();
        shareSelected();
        return true;
      }
      return false;
    },
    [focusSearch, handleSearchKey, refresh, shareSelected],
  );

  const rootBefore = (
    <PaneListChrome width={width} focused={focused && !openItemId} search={search} />
  );

  if (loading || (error && letters.length === 0)) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <PaneStatusBody loading={loading} error={error} subject="SEC comment letters" onRetry={refresh} />
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
      selectedItemId={selectedLetter?.id ?? null}
      onSelect={(index) => setSelectedId(letters[index]?.id ?? null)}
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
