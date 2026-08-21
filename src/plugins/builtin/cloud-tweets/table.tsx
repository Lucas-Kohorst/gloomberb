import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { TextAttributes } from "../../../ui";
import {
  DataTableStackView,
  TickerBadgeList,
  type DataTableCell,
  type DataTableKeyEvent,
  type DataTableRootKeyContext,
  type PaneHint,
} from "../../../components";
import { usePluginAppActions, usePluginConfigState } from "../../runtime";
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
  type TweetColumn,
  type TweetLoadState,
  type TweetSortDirection,
} from "./model";
import { usePaneStatusLinkFooter, paneSearchHint, paneRefreshHint } from "../shared/pane-footer";
import { tweetSharePayload, useCopyShareLink } from "../shared/article-share";
import { twitterLivePollingLabel, useTwitterFetchStaleLabel } from "./footer";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import {
  DEFAULT_TWITTER_POLL_INTERVAL_MINUTES,
  TWITTER_POLL_INTERVAL_CONFIG_KEY,
  X_LIVE_POLLING_CONFIG_KEY,
  isXLivePollingEnabled,
  twitterLivePollIntervalMinutes,
  useFeedPollInterval,
} from "../shared/feed-poll-interval";
import { usePopOutTweet } from "./pop-out";
import { TweetDetail } from "./tweet-detail";

function isAuthError(error: string | null): boolean {
  return !!error && /unauthorized|verification/i.test(error);
}

function useTweetSearchData(
  requestKey: string,
  load: () => Promise<CloudTweetSearchResponse>,
  onResult?: (result: CloudTweetSearchResponse) => void,
  onError?: (message: string) => void,
  enabled = true,
) {
  const [state, setState] = useState<TweetLoadState>({
    data: null,
    loading: false,
    error: null,
  });
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const fetchGenRef = useRef(0);
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  onResultRef.current = onResult;
  onErrorRef.current = onError;

  const reload = useCallback(() => {
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
    setState((current) => ({ ...current, loading: true, error: null }));
    load()
      .then((data) => {
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
  }, [enabled, load]);

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
  emptyStateHint?: string;
}) {
  const { createPaneFromTemplate } = usePluginAppActions();
  const { data, loading, error, lastUpdated, reload } = useTweetSearchData(requestKey, load, onResult, onError, enabled);
  const poll = useFeedPollInterval({
    overrideConfigKey: TWITTER_POLL_INTERVAL_CONFIG_KEY,
    defaultMinutes: DEFAULT_TWITTER_POLL_INTERVAL_MINUTES,
  });
  const [livePollingStored, setLivePolling] = usePluginConfigState<boolean>(
    X_LIVE_POLLING_CONFIG_KEY,
    false,
  );
  const livePolling = isXLivePollingEnabled(livePollingStored);
  const staleLabel = useTwitterFetchStaleLabel(lastUpdated);
  useAutoRefresh(
    lastUpdated,
    reload,
    twitterLivePollIntervalMinutes(livePolling, poll.intervalMinutes),
  );
  const [selectedTweetId, setSelectedTweetId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
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
  const popOutSelectedTweet = usePopOutTweet(closeDetail);
  const copyShareLink = useCopyShareLink();
  const shareSelectedTweet = selectedTweet
    ? () => copyShareLink(tweetSharePayload(selectedTweet))
    : undefined;
  const trailingHints = useMemo<PaneHint[]>(() => {
    if (!selectedTweet) return [];
    return [
      ...(shareSelectedTweet
        ? [{ id: "share", key: "y", label: " share", onPress: shareSelectedTweet }]
        : []),
      { id: "pop-out", key: "p", label: "op out", onPress: () => popOutSelectedTweet(selectedTweet) },
    ];
  }, [popOutSelectedTweet, selectedTweet, shareSelectedTweet]);
  const statusInfo = useMemo(() => [
    {
      id: "x-live-polling",
      parts: [{ text: twitterLivePollingLabel(livePolling), tone: "muted" as const }],
      onPress: () => setLivePolling(!livePolling),
    },
    ...(staleLabel
      ? [{ id: "stale", parts: [{ text: staleLabel, tone: "muted" as const }] }]
      : []),
  ], [livePolling, staleLabel]);
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
    trailingInfo: livePolling ? [poll.segment] : [],
    showOpenHint: !!selectedTweet?.url,
    hints: [
      ...(onFocusSearch ? [paneSearchHint(onFocusSearch)] : []),
      paneRefreshHint(reload),
    ],
    trailingHints,
  });

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
      openSelectedTweet();
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
    reload();
    return true;
  }, [onFocusSearch, openSelectedTweet, popOutSelectedTweet, reload, selectedTweet, shareSelectedTweet]);

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
    openSelectedTweet();
    return true;
  }, [openSelectedTweet, popOutSelectedTweet, selectedTweet, shareSelectedTweet]);

  const renderCell = useCallback((
    tweet: CloudTweetPayload,
    column: TweetColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "time":
        return { text: formatRelativeShort(tweet.createdAt), color: selectedColor ?? colors.textDim };
      case "author":
        return {
          text: `@${tweet.author.userName || tweet.author.name}`,
          color: selectedColor ?? colors.textBright,
          attributes: TextAttributes.BOLD,
        };
      case "text":
        return { text: formatTweetCellText(tweet.text), color: selectedColor ?? colors.text };
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
  }, []);

  const emptyContent = error && isAuthError(error)
    ? <CloudAuthNotice message={error} showSignup />
    : undefined;

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
        onChange: (id) => setSelectedTweetId(id),
      }}
      onActivate={(tweet) => {
        setSelectedTweetId(tweet.id);
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
      renderCell={renderCell}
      emptyContent={emptyContent}
      emptyStateTitle={loading ? "Loading tweets..." : error ?? emptyStateTitle ?? "No tweets"}
      emptyStateHint={emptyStateHint ?? data?.query}
    />
  );
}
