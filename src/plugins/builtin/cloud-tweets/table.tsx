import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { TextAttributes } from "../../../ui";
import {
  DataTableStackView,
  PaneStatusBody,
  TickerBadgeList,
  dataErrorMessage,
  isNoDataError,
  unavailableTitle,
  type DataTableCell,
  type DataTableKeyEvent,
  type DataTableRootKeyContext,
  type PaneHint,
} from "../../../components";
import { usePluginAppActions } from "../../runtime";
import { usePaneSettingValue } from "../../../state/app/context";
import { encodeSortPreference } from "../../../components/data-table/sort-settings";
import { getTwitterFeedPaneSettings } from "./settings";
import type { CloudTweetPayload, CloudTweetSearchResponse } from "../../../api-client";
import { formatTimeAgo } from "../../../utils/format";
import { colors } from "../../../theme/colors";
import { CloudAuthNotice } from "../cloud/auth-actions";
import { isPlainKey } from "../../../utils/keyboard";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import {
  buildTweetColumns,
  DEFAULT_TWEET_SORT,
  formatMetric,
  formatRelativeShort,
  formatTweetCellText,
  isTweetSortColumnId,
  normalizeTwitterUsername,
  tweetTextRowHeight,
  sortedTweets,
  tweetTickers,
  twitterUserSearchQuery,
  X_FEED_CONNECTION_ID,
  type TweetColumn,
  type TweetLoadState,
  type TweetSortDirection,
} from "./model";
import { usePaneStatusLinkFooter, paneSearchHint, paneRefreshHint } from "../shared/pane-footer";
import { tweetSharePayload, useCopyShareLink } from "../shared/article-share";
import { useTwitterFetchStaleLabel } from "./footer";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { useFeedPollInterval } from "../shared/feed-poll-interval";
import { getSharedNewsService } from "../../../news/hooks";
import { normalizeXMarketsTweet } from "./news-capability";
import { usePopOutTweet } from "./pop-out";
import { useTweetReadState } from "./read-state";
import { TweetDetail } from "./tweet-detail";

function isAuthError(error: string | null): boolean {
  return !!error && /unauthorized|verification/i.test(error);
}

// Result rows only lived in table state, so switching feed tabs refetched an
// identical search. Cached per request key for the life of the process; `r`
// still forces a fresh search.
// ponytail: in-memory only, move to plugin state if results must survive restarts
const TWEET_RESULT_CACHE = new Map<string, { data: CloudTweetSearchResponse; fetchedAt: number }>();
const TWEET_CACHE_TTL_MS = 5 * 60 * 1000;
// Every edited query is its own key, so the map is capped instead of growing
// with each keystroke-sized search.
const TWEET_CACHE_MAX_ENTRIES = 20;

function cacheTweetResult(requestKey: string, data: CloudTweetSearchResponse): void {
  TWEET_RESULT_CACHE.set(requestKey, { data, fetchedAt: Date.now() });
  while (TWEET_RESULT_CACHE.size > TWEET_CACHE_MAX_ENTRIES) {
    const oldest = TWEET_RESULT_CACHE.keys().next().value;
    if (oldest === undefined) break;
    TWEET_RESULT_CACHE.delete(oldest);
  }
}

function cachedTweetResult(requestKey: string): { data: CloudTweetSearchResponse; fetchedAt: number } | undefined {
  return TWEET_RESULT_CACHE.get(requestKey);
}

function useTweetSearchData(
  requestKey: string,
  load: () => Promise<CloudTweetSearchResponse>,
  onResult?: (result: CloudTweetSearchResponse) => void,
  onError?: (message: string) => void,
  enabled = true,
) {
  // Starts loading when a request is about to run so the first paint is not a
  // premature "No tweets".
  const [state, setState] = useState<TweetLoadState>(() => {
    const cached = cachedTweetResult(requestKey);
    return {
      data: cached?.data ?? null,
      loading: enabled && !cached,
      error: null,
    };
  });
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const fetchGenRef = useRef(0);
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  onResultRef.current = onResult;
  onErrorRef.current = onError;

  const reload = useCallback((force = false) => {
    if (!enabled) {
      fetchGenRef.current += 1;
      setState((current) => (
        current.data || current.loading || current.error
          ? { data: null, loading: false, error: null }
          : current
      ));
      return;
    }

    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    const cached = force ? undefined : cachedTweetResult(requestKey);
    const fresh = cached && Date.now() - cached.fetchedAt < TWEET_CACHE_TTL_MS;
    if (cached) setState({ data: cached.data, loading: !fresh, error: null });
    if (fresh) return;
    // A forced reload keeps the rows on screen; a new request key must not show
    // the previous feed's tweets while its own search runs.
    if (!cached) setState((current) => ({ data: force ? current.data : null, loading: true, error: null }));
    load()
      .then((data) => {
        cacheTweetResult(requestKey, data);
        if (fetchGenRef.current !== gen) return;
        setState({ data, loading: false, error: null });
        setLastUpdated(Date.now());
        onResultRef.current?.(data);
      })
      .catch((error) => {
        if (fetchGenRef.current !== gen) return;
        const message = error instanceof Error ? error.message : String(error);
        setState({ data: null, loading: false, error: message });
        onErrorRef.current?.(message);
      });
  }, [enabled, load, requestKey]);

  useEffect(() => {
    reload();
  }, [reload, requestKey]);

  return { ...state, lastUpdated, reload };
}

export function TweetSearchTable({
  focused,
  width,
  height,
  requestKey,
  footerId,
  rootBefore,
  enabled = true,
  load,
  onResult,
  onError,
  onFocusSearch,
  emptyStateTitle,
  emptyStateMessage,
  emptyStateHint,
}: {
  focused: boolean;
  width: number;
  height: number;
  requestKey: string;
  footerId: string;
  rootBefore?: ReactNode;
  enabled?: boolean;
  load: () => Promise<CloudTweetSearchResponse>;
  onResult?: (result: CloudTweetSearchResponse) => void;
  onError?: (message: string) => void;
  onFocusSearch?: () => void;
  emptyStateTitle?: string;
  emptyStateMessage?: string;
  emptyStateHint?: string;
}) {
  const { createPaneFromTemplate } = usePluginAppActions();
  const ingestTweets = useCallback((result: CloudTweetSearchResponse) => {
    const articles = result.tweets
      .map(normalizeXMarketsTweet)
      .filter((article): article is NonNullable<typeof article> => article !== null);
    if (articles.length > 0) getSharedNewsService()?.ingest(X_FEED_CONNECTION_ID, articles);
    onResult?.(result);
  }, [onResult]);
  const { data, loading, error, lastUpdated, reload } = useTweetSearchData(
    requestKey,
    load,
    ingestTweets,
    onError,
    enabled,
  );
  const poll = useFeedPollInterval();
  const staleLabel = useTwitterFetchStaleLabel(lastUpdated);
  useAutoRefresh(lastUpdated, reload, poll.intervalMinutes);
  const [selectedTweetId, setSelectedTweetId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const { readTweetIds, markTweetRead } = useTweetReadState();
  const [columnIds] = usePaneSettingValue<unknown>("columnIds", undefined);
  const [sortValue, setSortValue] = usePaneSettingValue<unknown>("sort", encodeSortPreference(DEFAULT_TWEET_SORT));
  const [density] = usePaneSettingValue<"comfortable" | "compact">("density", "comfortable");
  const paneSettings = getTwitterFeedPaneSettings({ columnIds, sort: sortValue, density });
  const rows = useMemo(
    () => sortedTweets(data?.tweets ?? [], paneSettings.sort.columnId, paneSettings.sort.direction),
    [data?.tweets, paneSettings.sort.columnId, paneSettings.sort.direction],
  );
  const columns = useMemo(() => buildTweetColumns(width, paneSettings.columnIds), [paneSettings.columnIds, width]);
  const tweetColumnWidth = columns.find((column) => column.id === "text")?.width ?? 40;
  const rowHeight = tweetTextRowHeight(tweetColumnWidth, paneSettings.density);
  const selectedIndex = rows.findIndex((tweet) => tweet.id === selectedTweetId);
  const activeIndex = selectedIndex >= 0 ? selectedIndex : rows.length > 0 ? 0 : -1;
  const selectedTweet = rows[activeIndex] ?? null;
  const closeDetail = useCallback(() => setDetailOpen(false), []);
  const popOutTweet = usePopOutTweet(closeDetail);
  const popOutSelectedTweet = useCallback((tweet: CloudTweetPayload) => {
    markTweetRead(tweet.id);
    popOutTweet(tweet);
  }, [markTweetRead, popOutTweet]);
  const copyShareLink = useCopyShareLink();
  const shareSelectedTweet = selectedTweet
    ? () => copyShareLink(tweetSharePayload(selectedTweet))
    : undefined;
  const trailingHints = useMemo<PaneHint[]>(() => {
    if (!selectedTweet) return [];
    return [
      ...(shareSelectedTweet
        ? [{ id: "share", key: "y", label: "share", onPress: shareSelectedTweet }]
        : []),
      { id: "pop-out", key: "p", label: "op out", onPress: () => popOutSelectedTweet(selectedTweet) },
    ];
  }, [popOutSelectedTweet, selectedTweet, shareSelectedTweet]);
  const statusInfo = useMemo(() => (
    staleLabel
      ? [{ id: "stale", parts: [{ text: staleLabel, tone: "muted" as const }] }]
      : []
  ), [staleLabel]);
  const openSelectedTweet = usePaneStatusLinkFooter({
    registrationId: footerId,
    focused,
    url: selectedTweet?.url,
    source: selectedTweet
      ? `@${selectedTweet.author.userName || selectedTweet.author.name}`
      : null,
    loading,
    error,
    info: statusInfo,
    trailingInfo: [poll.segment],
    showOpenHint: !!selectedTweet?.url,
    hints: [
      ...(onFocusSearch ? [paneSearchHint(onFocusSearch)] : []),
      paneRefreshHint(reload),
    ],
    trailingHints,
    onOpen: () => {
      if (selectedTweet) markTweetRead(selectedTweet.id);
    },
  });
  const openSelectedTweetAndMarkRead = useCallback(() => {
    if (selectedTweet) markTweetRead(selectedTweet.id);
    openSelectedTweet();
  }, [markTweetRead, openSelectedTweet, selectedTweet]);

  useEffect(() => {
    if (rows.length === 0) {
      if (selectedTweetId !== null) setSelectedTweetId(null);
      setDetailOpen(false);
      return;
    }
    if (!selectedTweetId || selectedIndex < 0) {
      setSelectedTweetId(rows[0]!.id);
    }
  }, [rows, selectedIndex, selectedTweetId]);

  const openUsernameFeed = useCallback((username: string) => {
    const normalizedUsername = normalizeTwitterUsername(username);
    if (!normalizedUsername) return;
    const query = twitterUserSearchQuery(normalizedUsername);
    createPaneFromTemplate("twitter-feed-pane", {
      arg: query,
      values: {
        query,
        queryType: "Latest",
      },
    });
  }, [createPaneFromTemplate]);

  const handleHeaderClick = useCallback((columnId: string) => {
    if (!isTweetSortColumnId(columnId)) return;
    const current = paneSettings.sort;
    const direction: TweetSortDirection = current.columnId === columnId && current.direction === "desc"
      ? "asc"
      : "desc";
    setSortValue(encodeSortPreference({ columnId, direction }));
  }, [paneSettings.sort, setSortValue]);

  const handleRootKeyDown = useCallback((
    event: DataTableKeyEvent,
    context: DataTableRootKeyContext,
  ) => {
    if (onFocusSearch && context.selectedIndex <= 0 && isPlainArrowUp(event)) {
      stopSearchFocusNavigation(event);
      onFocusSearch();
      return true;
    }
    if (onFocusSearch && isPlainKey(event, "/")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      onFocusSearch();
      return true;
    }
    if (isPlainKey(event, "o") && selectedTweet?.url) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openSelectedTweetAndMarkRead();
      return true;
    }
    if (isPlainKey(event, "y") && shareSelectedTweet) {
      event.preventDefault?.();
      event.stopPropagation?.();
      shareSelectedTweet();
      return true;
    }
    if (isPlainKey(event, "p") && selectedTweet) {
      event.preventDefault?.();
      event.stopPropagation?.();
      popOutSelectedTweet(selectedTweet);
      return true;
    }
    if (!isPlainKey(event, "r")) return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    reload(true);
    return true;
  }, [onFocusSearch, openSelectedTweetAndMarkRead, popOutSelectedTweet, reload, selectedTweet, shareSelectedTweet]);

  const handleDetailKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (isPlainKey(event, "y") && shareSelectedTweet) {
      event.preventDefault?.();
      event.stopPropagation?.();
      shareSelectedTweet();
      return true;
    }
    if (isPlainKey(event, "p") && selectedTweet) {
      event.preventDefault?.();
      event.stopPropagation?.();
      popOutSelectedTweet(selectedTweet);
      return true;
    }
    if (!isPlainKey(event, "o")) return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    openSelectedTweetAndMarkRead();
    return true;
  }, [openSelectedTweetAndMarkRead, popOutSelectedTweet, selectedTweet, shareSelectedTweet]);

  const renderCell = useCallback((
    tweet: CloudTweetPayload,
    column: TweetColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    const read = readTweetIds.has(tweet.id);
    switch (column.id) {
      case "time":
        return { text: formatRelativeShort(tweet.createdAt), color: selectedColor ?? colors.textDim };
      case "author":
        return {
          text: `@${tweet.author.userName || tweet.author.name}`,
          color: read ? colors.textMuted : (selectedColor ?? colors.textBright),
          attributes: read ? TextAttributes.NONE : TextAttributes.BOLD,
        };
      case "text":
        return {
          text: formatTweetCellText(tweet.text),
          color: read ? colors.textMuted : (selectedColor ?? colors.text),
        };
      case "tickers": {
        const tickers = tweetTickers(tweet);
        return {
          text: tickers.map((ticker) => `$${ticker}`).join(" "),
          content: (
            <TickerBadgeList
              symbols={tickers}
              width={column.width}
              fallbackColor={selectedColor ?? colors.positive}
              liveQuote={false}
            />
          ),
          color: selectedColor ?? colors.positive,
        };
      }
      case "likes":
        return { text: formatMetric(tweet.metrics.likes), color: selectedColor ?? colors.textDim };
      case "views":
        return { text: formatMetric(tweet.metrics.views), color: selectedColor ?? colors.textDim };
    }
  }, [readTweetIds]);

  const getRowRevision = useCallback((tweet: CloudTweetPayload) => {
    return `${tweet.id}:${readTweetIds.has(tweet.id) ? 1 : 0}`;
  }, [readTweetIds]);

  // Owns the whole empty body so loading, failure, and "nothing found" each get
  // their own rows instead of the table's single run-on empty line.
  const emptyContent = error && isAuthError(error)
    ? <CloudAuthNotice message={error} showSignup />
    : (
      <PaneStatusBody
        loading={loading}
        error={error}
        empty
        subject="Tweets"
        emptyTitle={emptyStateTitle ?? "No tweets"}
        emptyMessage={emptyStateHint ?? data?.query}
      />
    );

  return (
    <DataTableStackView<CloudTweetPayload, TweetColumn>
      focused={focused}
      detailOpen={detailOpen}
      onBack={() => setDetailOpen(false)}
      detailTitle={selectedTweet ? `@${selectedTweet.author.userName || selectedTweet.author.name} - ${formatTimeAgo(selectedTweet.createdAt)}` : "Tweet"}
      detailContent={selectedTweet ? <TweetDetail tweet={selectedTweet} width={width} onOpenUsername={openUsernameFeed} /> : null}
      selection={{
        kind: "id",
        selectedId: selectedTweetId,
        getId: (tweet) => tweet.id,
        onChange: (id: string) => {
          setSelectedTweetId(id);
        },
      }}
      onActivate={(tweet) => {
        setSelectedTweetId(tweet.id);
        markTweetRead(tweet.id);
        setDetailOpen(true);
      }}
      onRootKeyDown={handleRootKeyDown}
      onDetailKeyDown={handleDetailKeyDown}
      rootBefore={rootBefore}
      rootWidth={width}
      rootHeight={height}
      columns={columns}
      rowHeight={rowHeight}
      items={rows}
      sortColumnId={paneSettings.sort.columnId}
      sortDirection={paneSettings.sort.direction}
      onHeaderClick={handleHeaderClick}
      getItemKey={(tweet) => tweet.id}
      getRowRevision={getRowRevision}
      renderCell={renderCell}
      emptyContent={emptyContent}
      emptyStateTitle={emptyStateTitle ?? "No tweets"}
      emptyStateHint={emptyStateHint ?? data?.query}
    />
  );
}
