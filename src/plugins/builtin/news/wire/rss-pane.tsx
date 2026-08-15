import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, TextAttributes, useRendererHost } from "../../../../ui";
import {
  DataTableView,
  EmptyState,
  FeedDataTableStackView,
  Spinner,
  usePaneFooter,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
  type FeedDataTableItem,
} from "../../../../components";
import { ExternalLink } from "../../../../components/ui/external-link";
import type { PaneProps } from "../../../../types/plugin";
import type { PluginConfigState } from "../../../../types/plugin";
import { useDebouncedPluginPaneState, usePluginPaneState } from "../../../runtime";
import { usePluginRenderContext } from "../../../runtime/context";
import { useShortcut } from "../../../../react/input";
import { colors } from "../../../../theme/colors";
import { isPlainKey } from "../../../../utils/keyboard";
import { useNewsArticles } from "../../../../news/hooks";
import { usePersistedNewsArticles } from "./persisted-articles";
import { DEFAULT_FEEDS } from "./default-feeds";
import {
  addUserNewsFeed,
  getEnabledNewsFeeds,
  loadNewsFeedSettings,
  removeUserNewsFeed,
  setDefaultNewsFeedEnabled,
  updateUserNewsFeed,
} from "./feed-config";
import type { RssFeedConfig } from "./rss/parser";
import type { NewsArticle } from "../../../../types/news-source";
import { formatDetailDate } from "../../../../utils/datetime-format";

interface FeedRow {
  id: string;
  name: string;
  url: string;
  category: string;
  authority: number;
  enabled: boolean;
  isDefault: boolean;
}

type RssViewMode = "articles" | "feeds";

function usePluginConfigStateAdapter(): PluginConfigState {
  const { pluginId, runtime } = usePluginRenderContext();
  return useMemo(
    () => ({
      get: <T = unknown>(key: string) => runtime.getConfigState<T>(pluginId, key),
      set: (key: string, value: unknown) => runtime.setConfigState(pluginId, key, value),
      delete: (key: string) => runtime.deleteConfigState(pluginId, key),
      keys: () => runtime.getConfigStateKeys(pluginId),
    }),
    [pluginId, runtime],
  );
}

function buildFeedRows(
  defaultDisabledIds: Set<string>,
  userFeeds: RssFeedConfig[],
): FeedRow[] {
  const rows: FeedRow[] = DEFAULT_FEEDS.map((feed) => ({
    id: feed.id,
    name: feed.name,
    url: feed.url,
    category: feed.category ?? "general",
    authority: feed.authority,
    enabled: feed.enabled && !defaultDisabledIds.has(feed.id),
    isDefault: true,
  }));
  for (const feed of userFeeds) {
    rows.push({
      id: feed.id,
      name: feed.name,
      url: feed.url,
      category: feed.category ?? "general",
      authority: feed.authority,
      enabled: feed.enabled,
      isDefault: false,
    });
  }
  return rows;
}

function getArticleFeedItems(articles: NewsArticle[]): FeedDataTableItem[] {
  return articles.map((item) => ({
    id: item.id,
    eyebrow: item.source,
    title: item.title,
    timestamp: item.publishedAt,
    detailTitle: item.title,
    detailMeta: [
      item.source,
      `Published ${item.publishedAt.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })}`,
      ...(item.categories.length > 0 ? [item.categories.join(" · ")] : []),
    ],
    detailBody: item.summary ?? "",
    detailNote: item.url,
  }));
}

const CATEGORY_OPTIONS = ["general", "tech", "energy", "finance", "healthcare", "macro", "crypto"] as const;

function AddFeedForm({ width, onCancel, onSubmit }: {
  width: number;
  onCancel: () => void;
  onSubmit: (url: string, name: string, category: string) => void;
}) {
  const [field, setField] = useState<"url" | "name" | "category">("url");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [categoryIdx, setCategoryIdx] = useState(0);

  useShortcut((event) => {
    if (event.name === "Escape") {
      event.stopPropagation?.();
      event.preventDefault?.();
      onCancel();
      return;
    }
    if (event.name === "Tab" || event.name === "Enter") {
      event.stopPropagation?.();
      event.preventDefault?.();
      if (field === "url") {
        setField("name");
      } else if (field === "name") {
        setField("category");
      } else if (field === "category" && event.name === "Enter") {
        if (url.trim() && name.trim()) {
          onSubmit(url.trim(), name.trim(), CATEGORY_OPTIONS[categoryIdx]!);
        }
      }
      return;
    }
    if (field === "category" && (event.name === "Left" || event.name === "Right")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      setCategoryIdx((prev) => {
        const dir = event.name === "Right" ? 1 : -1;
        return (prev + dir + CATEGORY_OPTIONS.length) % CATEGORY_OPTIONS.length;
      });
      return;
    }
    if (field === "url" || field === "name") {
      event.stopPropagation?.();
      event.preventDefault?.();
      if (event.name === "Backspace") {
        if (field === "url") setUrl((prev) => prev.slice(0, -1));
        else setName((prev) => prev.slice(0, -1));
        return;
      }
      if (event.name && event.name.length === 1 && /^[a-zA-Z0-9.:/_-]$/.test(event.name)) {
        if (field === "url") setUrl((prev) => prev + event.name);
        else setName((prev) => prev + event.name);
        return;
      }
    }
  });

  return (
    <Box flexDirection="column" width={width} paddingX={1} paddingY={1} gap={1}>
      <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>Add RSS Feed</Text>
      <Box height={1} flexDirection="row">
        <Text fg={field === "url" ? colors.textBright : colors.textDim}>
          {field === "url" ? "> " : "  "}URL:{" "}
        </Text>
        <Text fg={colors.text}>{url || (field === "url" ? "_" : "")}</Text>
      </Box>
      <Box height={1} flexDirection="row">
        <Text fg={field === "name" ? colors.textBright : colors.textDim}>
          {field === "name" ? "> " : "  "}Name:{" "}
        </Text>
        <Text fg={colors.text}>{name || (field === "name" ? "_" : "")}</Text>
      </Box>
      <Box height={1} flexDirection="row">
        <Text fg={field === "category" ? colors.textBright : colors.textDim}>
          {field === "category" ? "> " : "  "}Category:{" "}
        </Text>
        <Text fg={colors.text}>{CATEGORY_OPTIONS[categoryIdx]}</Text>
        <Text fg={colors.textDim}> (← →)</Text>
      </Box>
      <Box height={1}>
        <Text fg={colors.textDim}>Tab=next field, Enter=submit, Esc=cancel</Text>
      </Box>
    </Box>
  );
}

function FeedsManager({ focused, width, height, onBack }: {
  focused: boolean;
  width: number;
  height: number;
  onBack: () => void;
}) {
  const rendererHost = useRendererHost();
  const configState = usePluginConfigStateAdapter();
  const [settings, setSettings] = useState(() => loadNewsFeedSettings(configState));
  const [selectedIdx, setSelectedIdx] = useDebouncedPluginPaneState<number>("feeds:selectedIdx", 0);
  const [showAddForm, setShowAddForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settingsVersion = useRef(0);

  const rows = useMemo(
    () => buildFeedRows(new Set(settings.disabledDefaultFeedIds), settings.userFeeds),
    [settings.disabledDefaultFeedIds, settings.userFeeds],
  );

  useEffect(() => {
    if (selectedIdx >= rows.length) setSelectedIdx(Math.max(0, rows.length - 1));
  }, [rows.length, selectedIdx, setSelectedIdx]);

  const selected = rows[selectedIdx];

  const refreshSettings = useCallback(() => {
    settingsVersion.current += 1;
    setSettings(loadNewsFeedSettings(configState));
  }, [configState]);

  const toggleFeed = useCallback(async (feed: FeedRow) => {
    if (feed.isDefault) {
      await setDefaultNewsFeedEnabled(configState, feed.id, !feed.enabled);
    } else {
      const userFeed = settings.userFeeds.find((f) => f.id === feed.id);
      if (!userFeed) return;
      await updateUserNewsFeed(configState, feed.id, { enabled: !feed.enabled });
    }
    refreshSettings();
  }, [configState, refreshSettings, settings.userFeeds]);

  const deleteFeed = useCallback(async (feed: FeedRow) => {
    if (feed.isDefault) return;
    await removeUserNewsFeed(configState, feed.id);
    refreshSettings();
  }, [configState, refreshSettings]);

  const submitAddFeed = useCallback(async (url: string, name: string, category: string) => {
    try {
      await addUserNewsFeed(configState, { url, name, category });
      setShowAddForm(false);
      setError(null);
      refreshSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [configState, refreshSettings]);

  const columns = useMemo<DataTableColumn[]>(() => [
    { id: "name", label: "Feed", width: Math.max(20, Math.floor(width * 0.35)), align: "left", flexGrow: 1 },
    { id: "category", label: "Category", width: 12, align: "left" },
    { id: "authority", label: "Auth", width: 6, align: "right" },
    { id: "status", label: "Status", width: 8, align: "left" },
  ], [width]);

  const renderCell = useCallback((
    row: FeedRow,
    column: DataTableColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "name":
        return { text: row.name, color: selectedColor ?? colors.text, attributes: row.enabled ? TextAttributes.BOLD : undefined };
      case "category":
        return { text: row.category, color: selectedColor ?? colors.textMuted };
      case "authority":
        return { text: String(row.authority), color: selectedColor ?? colors.textDim };
      case "status":
        return {
          text: row.enabled ? "on" : "off",
          color: selectedColor ?? (row.enabled ? colors.positive : colors.textDim),
        };
    }
    return { text: "", color: colors.textDim };
  }, []);

  const handleKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (isPlainKey(event, "a")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      setShowAddForm(true);
      return true;
    }
    if (isPlainKey(event, "d") && selected && !selected.isDefault) {
      event.preventDefault?.();
      event.stopPropagation?.();
      void deleteFeed(selected);
      return true;
    }
    if (isPlainKey(event, "t") && selected) {
      event.preventDefault?.();
      event.stopPropagation?.();
      void toggleFeed(selected);
      return true;
    }
    if (isPlainKey(event, "o") && selected) {
      event.preventDefault?.();
      event.stopPropagation?.();
      void rendererHost.openExternal(selected.url);
      return true;
    }
    if (isPlainKey(event, "f")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      onBack();
      return true;
    }
    return false;
  }, [deleteFeed, onBack, rendererHost, selected, toggleFeed]);

  usePaneFooter("rss-feeds", () => ({
    info: error ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : [],
    hints: [
      { id: "feeds", key: "f", label: "eeds", onPress: onBack },
      { id: "add", key: "a", label: "dd", onPress: () => setShowAddForm(true) },
      { id: "toggle", key: "t", label: "oggle", onPress: () => selected && void toggleFeed(selected) },
      ...(selected && !selected.isDefault ? [{ id: "delete", key: "d", label: "elete", onPress: () => void deleteFeed(selected) }] : []),
    ],
  }), [deleteFeed, error, onBack, selected, toggleFeed]);

  if (showAddForm) {
    return (
      <AddFeedForm
        width={width}
        onCancel={() => { setShowAddForm(false); setError(null); }}
        onSubmit={submitAddFeed}
      />
    );
  }

  if (rows.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <EmptyState title="No RSS feeds configured." hint="Press a to add a feed." />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box height={1} paddingX={1}>
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
          RSS Feeds ({rows.length})
        </Text>
      </Box>
      <DataTableView<FeedRow, DataTableColumn>
        focused={focused}
        selection={{
          kind: "index",
          selectedIndex: selectedIdx,
          onChange: (index) => setSelectedIdx(index),
        }}
        onRootKeyDown={handleKeyDown}
        rootWidth={width}
        rootHeight={height - 1}
        columns={columns}
        items={rows}
        sortColumnId={null}
        sortDirection="asc"
        onHeaderClick={() => {}}
        getItemKey={(row) => row.id}
        renderCell={renderCell}
        emptyStateTitle="No feeds"
      />
    </Box>
  );
}

function RssArticlesView({ focused, width, height, onManageFeeds }: {
  focused: boolean;
  width: number;
  height: number;
  onManageFeeds: () => void;
}) {
  const rendererHost = useRendererHost();
  const newsState = useNewsArticles({ feed: "latest", limit: 200 });
  const articles = usePersistedNewsArticles("rss:articles", newsState.articles);
  const [selectedArticleId, setSelectedArticleId] = useDebouncedPluginPaneState<string | null>("rss:selectedArticleId", null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const loading = newsState.phase === "loading" || (newsState.phase === "refreshing" && articles.length === 0);

  const sortedArticles = useMemo(
    () => [...articles].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()),
    [articles],
  );

  const selectedArticle = useMemo(
    () => sortedArticles.find((a) => a.id === selectedArticleId) ?? sortedArticles[0] ?? null,
    [sortedArticles, selectedArticleId],
  );

  useEffect(() => {
    if (sortedArticles.length > 0 && (!selectedArticleId || !sortedArticles.find((a) => a.id === selectedArticleId))) {
      setSelectedArticleId(sortedArticles[0]!.id);
    }
  }, [sortedArticles, selectedArticleId, setSelectedArticleId]);

  const selectedIdx = sortedArticles.findIndex((a) => a.id === selectedArticleId);

  const openArticle = useCallback(() => {
    if (selectedArticle) {
      setOpenItemId(selectedArticle.id);
      void rendererHost.openExternal(selectedArticle.url);
    }
  }, [rendererHost, selectedArticle]);

  const handleKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (isPlainKey(event, "m")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      onManageFeeds();
      return true;
    }
    if (isPlainKey(event, "o") && selectedArticle) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openArticle();
      return true;
    }
    return false;
  }, [onManageFeeds, openArticle, selectedArticle]);

  usePaneFooter("rss-articles", () => ({
    info: loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : [],
    hints: [
      { id: "manage", key: "m", label: "anage", onPress: onManageFeeds },
      ...(selectedArticle ? [{ id: "open", key: "o", label: "pen", onPress: openArticle }] : []),
    ],
  }), [loading, onManageFeeds, openArticle, selectedArticle]);

  if (loading && articles.length === 0) {
    return <Spinner label="Loading RSS feeds..." />;
  }

  if (articles.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <EmptyState title="No RSS articles." hint="Press m to manage feeds and ensure feeds are enabled." />
      </Box>
    );
  }

  const items = getArticleFeedItems(sortedArticles);

  const detailContent = selectedArticle ? (
    <Box flexDirection="column" width={width} flexGrow={1} minHeight={0} overflow="hidden" paddingX={1} paddingY={1}>
      <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{selectedArticle.title}</Text>
      <Box height={1} flexDirection="row">
        <Text fg={colors.textDim}>{selectedArticle.source} · {formatDetailDate(selectedArticle.publishedAt)}</Text>
      </Box>
      {selectedArticle.summary && (
        <Box flexDirection="column" marginTop={1}>
          {selectedArticle.summary.split("\n").map((line, i) => (
            <Box key={i} height={1}>
              <Text fg={colors.text}>{line}</Text>
            </Box>
          ))}
        </Box>
      )}
      {selectedArticle.categories.length > 0 && (
        <Box height={1} flexDirection="row" marginTop={1}>
          <Text fg={colors.textMuted}>{selectedArticle.categories.join(" · ")}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <ExternalLink url={selectedArticle.url} color={colors.textDim} />
      </Box>
    </Box>
  ) : null;

  return (
    <FeedDataTableStackView
      width={width}
      height={height}
      focused={focused}
      items={items}
      selectedIdx={Math.max(0, selectedIdx)}
      onSelect={(idx) => setSelectedArticleId(sortedArticles[idx]?.id ?? null)}
      onOpenItemIdChange={setOpenItemId}
      onRootKeyDown={handleKeyDown}
      sourceLabel="Source"
      titleLabel="Headline"
      emptyStateTitle="No RSS articles."
    />
  );
}

export function RssPane({ focused, width, height }: PaneProps) {
  const [viewMode, setViewMode] = usePluginPaneState<RssViewMode>("rss:viewMode", "articles");

  if (viewMode === "feeds") {
    return (
      <FeedsManager
        focused={focused}
        width={width}
        height={height}
        onBack={() => setViewMode("articles")}
      />
    );
  }

  return (
    <RssArticlesView
      focused={focused}
      width={width}
      height={height}
      onManageFeeds={() => setViewMode("feeds")}
    />
  );
}
