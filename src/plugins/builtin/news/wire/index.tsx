import type { NewsQuery } from "../../../../news/types";
import type { PaneProps } from "../../../../types/plugin";
import type { PluginModule } from "../../plugin-module";
import { BreakingPane } from "./breaking/pane";
import {
  BREAKING_NEWS_NOTIFICATIONS_ENABLED_KEY,
  setupBreakingNewsNotifications,
} from "./breaking/notifications";
import {
  addUserNewsFeed,
  getEnabledNewsFeeds,
  loadNewsFeedSettings,
  saveNewsFeedSettings,
} from "./feed-config";
import { IndustryPane } from "./industry-pane";
import { NewsPresetPane } from "./news/preset-pane";
import { NEWS_QUERY_PRESETS } from "./news/query-presets";
import type { NewsColumnId, NewsSortPreference } from "./news/table";
import { createRssNewsCapability } from "./rss/source";
import { RssPane } from "./rss-pane";
import { NewsArticleReaderPane } from "./news/article-reader";
import {
  ARTICLE_READER_FLOATING_SIZE,
  NEWS_ARTICLE_READER_PANE_ID,
  NEWS_ARTICLE_READER_TEMPLATE_ID,
  articleReaderInstanceId,
} from "../../shared/article-pop-out";
import {
  buildOpenArticleCommandResults,
  cachedNewsArticles,
  loadNewsArticles,
  openNewsArticle,
  searchNewsArticles,
} from "./article-search";
import { searchAdjacentRelatedArticles } from "../../adjacent/news";
import { registerConnectionSource } from "../../connections/register";

interface NewsPresetPaneConfig {
  paneKey: string;
  title: string;
  query: NewsQuery;
  columns: NewsColumnId[];
  defaultSort: NewsSortPreference;
  emptyStateTitle: string;
  emptyStateHint: string;
}

function createNewsPresetPane(config: NewsPresetPaneConfig) {
  return function PresetNewsPane(props: PaneProps) {
    return <NewsPresetPane {...props} {...config} />;
  };
}

const TopPane = createNewsPresetPane({
  paneKey: "top",
  title: "Top News",
  query: NEWS_QUERY_PRESETS.top,
  columns: ["time", "title", "tickers", "importance"],
  defaultSort: { columnId: "importance", direction: "desc" },
  emptyStateTitle: "No top stories yet",
  emptyStateHint: "Try refreshing later as new headlines are ranked.",
});

const FeedPane = createNewsPresetPane({
  paneKey: "feed",
  title: "News Feed",
  query: NEWS_QUERY_PRESETS.feed,
  columns: ["time", "source", "title", "tickers", "categories"],
  defaultSort: { columnId: "time", direction: "desc" },
  emptyStateTitle: "No feed stories yet",
  emptyStateHint: "Try refreshing later as wire stories arrive.",
});

let disposeBreakingNewsNotifications: (() => void) | null = null;
let disposeRssConnection: (() => void) | null = null;
let disposeJinaConnection: (() => void) | null = null;

export const newsWireModule: PluginModule = {
  panes: [
    { id: "news-top", name: "Top News", icon: "T", component: TopPane, defaultPosition: "right", defaultMode: "floating", defaultFloatingSize: { width: 90, height: 30 } },
    { id: "news-feed", name: "News Feed", icon: "N", component: FeedPane, defaultPosition: "right", defaultMode: "floating", defaultFloatingSize: { width: 100, height: 35 } },
    { id: "news-industry", name: "Sector News", icon: "S", component: IndustryPane, defaultPosition: "right", defaultMode: "floating", defaultFloatingSize: { width: 100, height: 35 } },    { id: "news-rss", name: "RSS Feeds", icon: "R", component: RssPane, defaultPosition: "right", defaultMode: "floating", defaultFloatingSize: { width: 90, height: 30 } },
    { id: "news-breaking",
      name: "Breaking News",
      icon: "!",
      component: BreakingPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 85, height: 20 },
      settings: {
        title: "Breaking News Settings",
        fields: [{
          key: BREAKING_NEWS_NOTIFICATIONS_ENABLED_KEY,
          label: "Notifications",
          description: "Notify when new breaking stories arrive, even while this pane is closed.",
          type: "toggle",
          storage: "plugin",
        }],
      },
    },
    {
      id: NEWS_ARTICLE_READER_PANE_ID,
      name: "Article",
      icon: "A",
      component: NewsArticleReaderPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: ARTICLE_READER_FLOATING_SIZE,
    },
  ],
  paneTemplates: [
    { id: "news-top-pane", paneId: "news-top", label: "Top News", description: "Curated top market stories ranked by importance", keywords: ["top", "news", "headlines", "stories"], shortcut: { prefix: "TOP" } },
    { id: "news-feed-pane", paneId: "news-feed", label: "News Feed", description: "Chronological market news firehose", keywords: ["news", "feed", "firehose", "wire", "stream"], shortcut: { prefix: "N" } },
    { id: "news-industry-pane", paneId: "news-industry", label: "Sector News", description: "Market news filtered by sector", keywords: ["news", "industry", "sector", "ni", "filter"], shortcut: { prefix: "NI" } },
    { id: "news-breaking-pane", paneId: "news-breaking", label: "Breaking News", description: "Breaking and urgent market news", keywords: ["first", "breaking", "urgent", "alert", "flash"], shortcut: { prefix: "FIRST" } },
    {
      id: "news-rss-pane",
      paneId: "news-rss",
      label: "RSS Feeds",
      description: "Read subscribed RSS feeds, including Adjacent Press and other custom sources. Search headlines from the command bar with ART.",
      keywords: ["rss", "feed", "subscribe", "news", "reader", "adjacent", "press", "article"],
      shortcut: { prefix: "RSS" },
    },
    {
      id: NEWS_ARTICLE_READER_TEMPLATE_ID,
      paneId: NEWS_ARTICLE_READER_PANE_ID,
      label: "News Article",
      description: "Read a popped-out news article.",
      keywords: ["news", "article", "reader"],
      canCreate: (_context, options) => !!options?.arg?.trim(),
      createInstance: (_context, options) => {
        const articleId = options?.arg?.trim() ?? "";
        if (!articleId) return null;
        return {
          instanceId: articleReaderInstanceId(NEWS_ARTICLE_READER_PANE_ID, articleId),
          title: options?.values?.title?.trim() || "Article",
          placement: "floating",
          settings: {
            articleId,
            title: options?.values?.title ?? "",
            url: options?.values?.url ?? "",
            source: options?.values?.source ?? "",
          },
        };
      },
    },
  ],
  setup(ctx) {
    const initialSettings = loadNewsFeedSettings(ctx.configState);
    if (initialSettings.migrated) {
      void saveNewsFeedSettings(ctx.configState, initialSettings);
    }

    const source = createRssNewsCapability(
      () => getEnabledNewsFeeds(loadNewsFeedSettings(ctx.configState)),
      { persistence: ctx.persistence },
    );
    ctx.registerCapability(source);
    disposeRssConnection = registerConnectionSource({
      id: "rss",
      name: "RSS Feeds",
      kind: "news",
      pluginId: "news",
      priority: 400,
    });
    disposeJinaConnection = registerConnectionSource({
      id: "jina-ai",
      name: "Jina AI Reader",
      kind: "news",
      pluginId: "news",
      priority: 450,
      authRequired: false,
    });

    ctx.registerCommand({
      id: "open-news-article",
      label: "Open Article",
      description: "Open a news article from enabled RSS feeds (including Adjacent Press) and Adjacent News. Search by headline or topic, e.g. ART hormuz.",
      keywords: [
        "article",
        "news",
        "rss",
        "headline",
        "story",
        "adjacent",
        "press",
        "open",
        "hormuz",
        "strait",
      ],
      category: "navigation",
      shortcut: "ART",
      shortcutArg: {
        placeholder: "headline or topic",
        kind: "text",
        parse: (arg) => ({ query: arg.trim() }),
      },
      buildResults: (arg) => buildOpenArticleCommandResults(
        cachedNewsArticles(),
        arg,
        ctx.createPaneFromTemplate,
      ),
      async execute(values) {
        const query = values?.query ?? values?.shortcut ?? "";
        const articles = [
          ...await loadNewsArticles(),
          ...await searchAdjacentRelatedArticles(query),
        ];
        const match = searchNewsArticles(articles, query)[0];
        if (!match) {
          ctx.notify({
            body: query.trim()
              ? `No article matched "${query.trim()}".`
              : "No articles loaded yet.",
            type: "error",
          });
          return;
        }
        openNewsArticle(match, ctx.createPaneFromTemplate);
      },
    });

    ctx.registerCommand({
      id: "add-news-feed",
      label: "Add News Feed",
      keywords: ["news", "rss", "feed", "add", "source"],
      category: "config",
      description: "Add a custom RSS news feed",
      wizardLayout: "form",
      wizard: [
        { key: "url", label: "Feed URL", type: "text", placeholder: "https://example.com/rss" },
        { key: "name", label: "Feed Name", type: "text", placeholder: "My Feed" },
        { key: "category", label: "Category", type: "select", options: [
          { label: "General", value: "general" },
          { label: "Tech", value: "tech" },
          { label: "Energy", value: "energy" },
          { label: "Finance", value: "finance" },
          { label: "Healthcare", value: "healthcare" },
          { label: "Macro", value: "macro" },
          { label: "Crypto", value: "crypto" },
        ]},
      ],
      async execute(values) {
        const url = values?.url?.trim();
        const name = values?.name?.trim();
        const category = values?.category ?? "general";
        if (!url || !name) return;

        const feed = await addUserNewsFeed(ctx.configState, { url, name, category });
        ctx.notify({ body: `Added news feed: ${feed.name}`, type: "success" });
      },
    });

    disposeBreakingNewsNotifications = setupBreakingNewsNotifications(ctx);
  },
  dispose() {
    disposeBreakingNewsNotifications?.();
    disposeBreakingNewsNotifications = null;
    disposeRssConnection?.();
    disposeRssConnection = null;
    disposeJinaConnection?.();
    disposeJinaConnection = null;
  },
};
