import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { Box, type InputRenderable } from "../../../ui";
import {
  EmptyState,
  Tabs,
} from "../../../components";
import type { PaneProps, TickerResearchTabProps } from "../../../types/plugin";
import { usePaneInstance, usePaneInstanceId, usePaneTicker } from "../../../state/app/context";
import { usePluginConfigState, usePluginPaneState, usePluginState } from "../../runtime";
import { type CloudTweetQueryType, type CloudTweetSearchResponse } from "../../../api-client";
import { getXTickerTweets, searchXFeedTweets } from "./client";
import { truncateWithEllipsis } from "../../../utils/text-wrap";
import {
  DEFAULT_TWEET_HOURS,
  DEFAULT_TWEET_LIMIT,
  EMPTY_FEED_STATE,
  TWEET_SEARCH_SCHEMA_VERSION,
  TWITTER_FEED_LAUNCH_SCHEMA_VERSION,
  TWITTER_FEED_LAUNCH_STATE_KEY,
  TWITTER_FEEDS_CONFIG_KEY,
  createFeed,
  deriveFeedTitle,
  normalizeFeedQuery,
  parseTwitterFeedState,
  persistTwitterFeedState,
  resolvePersistedTwitterFeeds,
  resolveTwitterFeedQuery,
  twitterFeedResumeStateKey,
  type PersistedTwitterFeedState,
  type TwitterFeed,
  type TwitterFeedLaunchRequest,
} from "./model";
import { TweetSearchTable } from "./table";
import { TwitterFeedSearchBar } from "./search-bar";
import { useTwitterFeedKeyboard } from "./keyboard";

export function TwitterTickerTab({ focused, width, height }: TickerResearchTabProps) {
  const { symbol } = usePaneTicker();
  const load = useCallback(() => {
    if (!symbol) throw new Error("No ticker selected");
    return getXTickerTweets({
      ticker: symbol,
      hours: DEFAULT_TWEET_HOURS,
      limit: DEFAULT_TWEET_LIMIT,
      includeReplies: false,
    });
  }, [symbol]);

  if (!symbol) {
    return <EmptyState title="No ticker selected." />;
  }

  return (
    <TweetSearchTable
      focused={focused}
      width={width}
      height={height}
      requestKey={`ticker:${symbol}`}
      footerId="ticker-tweets"
      load={load}
    />
  );
}

export function TwitterFeedPane({ focused, width, height }: PaneProps) {
  const paneId = usePaneInstanceId();
  const paneInstance = usePaneInstance();
  const [configState, setConfigState] = usePluginConfigState<PersistedTwitterFeedState>(
    TWITTER_FEEDS_CONFIG_KEY,
    EMPTY_FEED_STATE,
  );
  const [resumeState, setResumeState] = usePluginState<PersistedTwitterFeedState>(
    twitterFeedResumeStateKey(paneId),
    EMPTY_FEED_STATE,
    { schemaVersion: TWEET_SEARCH_SCHEMA_VERSION },
  );
  const [launchRequest, setLaunchRequest] = usePluginState<TwitterFeedLaunchRequest | null>(
    TWITTER_FEED_LAUNCH_STATE_KEY,
    null,
    { schemaVersion: TWITTER_FEED_LAUNCH_SCHEMA_VERSION },
  );
  const [legacyPaneActiveFeedId] = usePluginPaneState<string | null>("activeFeedId", null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);
  const initializedRef = useRef(false);
  const resumeStateRef = useRef(resumeState);
  resumeStateRef.current = resumeState;
  const legacyPaneActiveFeedIdRef = useRef(legacyPaneActiveFeedId);
  legacyPaneActiveFeedIdRef.current = legacyPaneActiveFeedId;

  const persistedState = useMemo(() => resolvePersistedTwitterFeeds({
    config: configState,
    resume: resumeState,
    paneActiveFeedId: legacyPaneActiveFeedId,
  }), [configState, legacyPaneActiveFeedId, resumeState]);
  const feeds = persistedState.feeds;
  const activeFeedId = persistedState.activeFeedId ?? null;

  const setPersistedState = useCallback((next: SetStateAction<PersistedTwitterFeedState>) => {
    setConfigState((current) => {
      const parsed = resolvePersistedTwitterFeeds({
        config: current,
        resume: resumeStateRef.current,
        paneActiveFeedId: legacyPaneActiveFeedIdRef.current,
      });
      const resolved = typeof next === "function" ? next(parsed) : next;
      return persistTwitterFeedState(resolved);
    });
  }, [setConfigState]);

  const setActiveFeedId = useCallback((id: string | null) => {
    setPersistedState((current) => ({ ...current, activeFeedId: id }));
  }, [setPersistedState]);

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((current) => current + 1);
  }, []);

  const blurSearch = useCallback(() => {
    setSearchFocused(false);
  }, []);

  const updateFeeds = useCallback((updater: (feeds: TwitterFeed[]) => TwitterFeed[]) => {
    setPersistedState((current) => ({
      ...current,
      feeds: updater(current.feeds),
    }));
  }, [setPersistedState]);

  const addFeed = useCallback((query = "", queryType: CloudTweetQueryType = "Latest") => {
    const feed = createFeed(query, queryType);
    setPersistedState((current) => ({
      feeds: [...current.feeds, feed],
      activeFeedId: feed.id,
    }));
    focusSearch();
    return feed.id;
  }, [focusSearch, setPersistedState]);

  const openOrCreateFeed = useCallback((
    query: string,
    queryType: CloudTweetQueryType = "Latest",
    options?: { focusSearch?: boolean },
  ) => {
    const normalizedQuery = normalizeFeedQuery(query);
    if (!normalizedQuery) {
      if (feeds.length === 0) addFeed("", queryType);
      return;
    }

    setPersistedState((current) => {
      const existing = current.feeds.find((feed) => normalizeFeedQuery(feed.query) === normalizedQuery);
      if (existing) {
        return { ...current, activeFeedId: existing.id };
      }
      const feed = createFeed(query, queryType);
      return {
        feeds: [...current.feeds, feed],
        activeFeedId: feed.id,
      };
    });
    if (options?.focusSearch) focusSearch();
  }, [addFeed, feeds.length, focusSearch, setPersistedState]);

  const updateFeedQuery = useCallback((feedId: string, query: string) => {
    const now = Date.now();
    updateFeeds((current) => current.map((feed) => (
      feed.id === feedId
        ? {
          ...feed,
          query,
          title: deriveFeedTitle(query),
          updatedAt: now,
          lastError: null,
        }
        : feed
    )));
  }, [updateFeeds]);

  useEffect(() => {
    if (initializedRef.current) return;
    if (feeds.length > 0) {
      initializedRef.current = true;
      if (parseTwitterFeedState(configState).feeds.length === 0) {
        setPersistedState({
          feeds,
          activeFeedId,
        });
        setResumeState(EMPTY_FEED_STATE);
      }
      return;
    }
    const launchTargetsThisPane = !!launchRequest && (
      !launchRequest.targetPaneId || launchRequest.targetPaneId === paneId
    );
    if (launchTargetsThisPane) {
      initializedRef.current = true;
      return;
    }

    initializedRef.current = true;
    const seedQuery = resolveTwitterFeedQuery(
      typeof paneInstance?.params?.query === "string" ? paneInstance.params.query : "",
    );
    const seedType = paneInstance?.params?.queryType === "Top" ? "Top" : "Latest";
    const feed = createFeed(seedQuery, seedType);
    setPersistedState({ feeds: [feed], activeFeedId: feed.id });
  }, [
    activeFeedId,
    configState,
    feeds,
    launchRequest,
    paneId,
    paneInstance?.params?.query,
    paneInstance?.params?.queryType,
    setPersistedState,
    setResumeState,
  ]);

  useEffect(() => {
    if (!launchRequest) return;
    if (launchRequest.targetPaneId && launchRequest.targetPaneId !== paneId) return;

    const queryType = launchRequest.queryType === "Top" ? "Top" : "Latest";
    openOrCreateFeed(resolveTwitterFeedQuery(launchRequest.query), queryType);
    setLaunchRequest(null);
  }, [launchRequest, openOrCreateFeed, paneId, setLaunchRequest]);

  useEffect(() => {
    if (feeds.length === 0) {
      if (activeFeedId !== null) setActiveFeedId(null);
      return;
    }
    if (!activeFeedId || !feeds.some((feed) => feed.id === activeFeedId)) {
      setActiveFeedId(feeds[0]!.id);
    }
  }, [activeFeedId, feeds, setActiveFeedId]);

  const activeFeed = feeds.find((feed) => feed.id === activeFeedId) ?? feeds[0] ?? null;

  const removeFeed = useCallback((feedId: string) => {
    let createdEmpty = false;
    setPersistedState((current) => {
      const next = current.feeds.filter((feed) => feed.id !== feedId);
      if (next.length === 0) {
        const feed = createFeed("", "Latest");
        createdEmpty = true;
        return { feeds: [feed], activeFeedId: feed.id };
      }
      const nextActiveId = current.activeFeedId === feedId
        ? next[0]!.id
        : current.activeFeedId && next.some((feed) => feed.id === current.activeFeedId)
          ? current.activeFeedId
          : next[0]!.id;
      return { feeds: next, activeFeedId: nextActiveId };
    });
    if (createdEmpty) focusSearch();
  }, [focusSearch, setPersistedState]);

  const cycleFeeds = useCallback((direction: -1 | 1) => {
    if (!activeFeed || feeds.length <= 1) return;
    const index = feeds.findIndex((feed) => feed.id === activeFeed.id);
    const nextIndex = (index + direction + feeds.length) % feeds.length;
    setActiveFeedId(feeds[nextIndex]!.id);
  }, [activeFeed, feeds, setActiveFeedId]);

  useTwitterFeedKeyboard({
    activeFeed,
    addFeed,
    blurSearch,
    cycleFeeds,
    focusSearch,
    focused,
    removeFeed,
    searchFocused,
  });

  const activeFeedIdValue = activeFeed?.id ?? null;
  const activeFeedQuery = activeFeed?.query.trim() ?? "";
  const activeFeedQueryType = activeFeed?.queryType ?? "Latest";
  const searchEnabled = activeFeedQuery.length > 0;
  const loadActiveFeed = useCallback(() => {
    if (!activeFeedQuery) throw new Error("No X feed selected");
    return searchXFeedTweets({
      query: activeFeedQuery,
      queryType: activeFeedQueryType,
      hours: DEFAULT_TWEET_HOURS,
      limit: DEFAULT_TWEET_LIMIT,
    });
  }, [activeFeedQuery, activeFeedQueryType]);

  const markFeedResult = useCallback((result: CloudTweetSearchResponse) => {
    if (!activeFeedIdValue) return;
    const now = Date.now();
    updateFeeds((current) => current.map((feed) => (
      feed.id === activeFeedIdValue
        ? { ...feed, lastSuccessAt: now, lastError: null, title: deriveFeedTitle(result.query) }
        : feed
    )));
  }, [activeFeedIdValue, updateFeeds]);

  const markFeedError = useCallback((message: string) => {
    if (!activeFeedIdValue) return;
    updateFeeds((current) => current.map((feed) => (
      feed.id === activeFeedIdValue ? { ...feed, lastError: message } : feed
    )));
  }, [activeFeedIdValue, updateFeeds]);

  const searchBar = activeFeed ? (
    <TwitterFeedSearchBar
      feed={activeFeed}
      focused={focused}
      active={searchFocused}
      width={width}
      focusToken={searchFocusToken}
      inputRef={searchInputRef}
      onFocus={focusSearch}
      onBlur={blurSearch}
      onNavigateDown={blurSearch}
      onQueryChange={updateFeedQuery}
    />
  ) : null;

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box height={1}>
        <Tabs
          tabs={feeds.map((feed) => ({
            label: truncateWithEllipsis(feed.title, 18),
            value: feed.id,
            onClose: removeFeed,
            onDoubleClick: focusSearch,
          }))}
          activeValue={activeFeed?.id ?? null}
          onSelect={(id) => {
            setActiveFeedId(id);
          }}
          compact
          variant="pill"
          closeMode="active"
          onAdd={() => addFeed()}
          focused={focused && !searchFocused}
        />
      </Box>

      {!activeFeed ? (
        <Box padding={1} flexGrow={1}>
          <EmptyState title="No X feeds yet." />
        </Box>
      ) : (
        <TweetSearchTable
          focused={focused && !searchFocused}
          width={width}
          height={Math.max(1, height - 1)}
          requestKey={`feed:${activeFeed.id}:${activeFeed.query}:${activeFeed.queryType}`}
          footerId="twitter-feed-search"
          rootBefore={searchBar}
          enabled={searchEnabled}
          load={loadActiveFeed}
          onResult={markFeedResult}
          onError={markFeedError}
          onFocusSearch={focusSearch}
          emptyStateTitle={searchEnabled ? "No tweets" : "Enter a search query"}
          emptyStateHint={searchEnabled ? activeFeedQuery : undefined}
        />
      )}
    </Box>
  );
}
