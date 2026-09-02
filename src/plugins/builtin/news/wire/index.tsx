import type { NewsQuery } from "../../../../news/types";
import type { PaneProps } from "../../../../types/plugin";
import type { PluginModule } from "../../plugin-module";
import { BreakingPane } from "./breaking/pane";
import {
  BREAKING_NEWS_NOTIFICATIONS_ENABLED_KEY,
  setupBreakingNewsNotifications,
} from "./breaking/notifications";
import {
  BREAKING_MUTED_SECTOR_OPTIONS,
  BREAKING_NEWS_MUTED_SECTORS_KEY,
  BREAKING_NEWS_SCOPE_KEY,
  BREAKING_SCOPE_OPTIONS,
} from "./breaking/filters";
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
import { openUrl } from "../../../../components/ui/external-link";
import {
  cachedNewsArticles,
  loadNewsArticles,
  searchNewsArticles,
} from "./article-search";

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
  paneKey: "top:curated",
  title: "Top News",
  query: NEWS_QUERY_PRESETS.top,
  columns: ["time", "source", "title", "tickers", "categories", "importance"],
  defaultSort: { columnId: "importance", direction: "desc" },
  emptyStateTitle: "No top stories yet",
  emptyStateHint: "Top stories appear when curated market sources publish them.",
});

const FeedPane = createNewsPresetPane({
  paneKey: "feed",
  title: "News Feed",
  query: NEWS_QUERY_PRESETS.feed,
  columns: ["time", "source", "title", "tickers", "categories", "sentiment"],
  defaultSort: { columnId: "time", direction: "desc" },
  emptyStateTitle: "No feed stories yet",
  emptyStateHint: "Run the Add News Feed command to wire up another source.",
});

let disposeBreakingNewsNotifications: (() => void) | null = null;
let disposeRssConnection: (() => void) | null = null;
let disposeJinaConnection: (() => void) | null = null;

export const newsWireModule: PluginModule = {
  panes: [
    {
      id: "news-top",
      name: "Top News",
      icon: "T",
      component: TopPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 90, height: 30 },
      settings: (context) => buildNewsPaneSettingsDef(context.settings, {
        columns: ["time", "title", "tickers", "importance"],
        sort: { columnId: "importance", direction: "desc" },
      }, { title: "Top News Settings" }),
    },
    {
      id: "news-feed",
      name: "News Feed",
      icon: "N",
      component: FeedPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 35 },
      settings: (context) => buildNewsPaneSettingsDef(context.settings, {
        columns: ["time", "source", "title", "tickers", "categories"],
        sort: { columnId: "time", direction: "desc" },
      }, { title: "News Feed Settings" }),
    },
    {
      id: "news-industry",
      name: "Sector News",
      icon: "S",
      component: IndustryPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 35 },
      settings: (context) => buildNewsPaneSettingsDef(context.settings, {
        columns: ["time", "source", "title", "tickers", "categories"],
        sort: { columnId: "time", direction: "desc" },
      }, { title: "Sector News Settings", includeDefaultTab: true }),
    },
    {
      id: "news-rss",
      name: "RSS Feeds",
      icon: "R",
      component: RssPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 90, height: 30 },
      settings: (context) => buildRssPaneSettingsDef(context.settings),
    },
    { id: "news-breaking",
      name: "Breaking News",
      icon: "!",
      component: BreakingPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 85, height: 20 },
      settings: {
        title: "Breaking News Settings",
        fields: [
          {
            key: BREAKING_NEWS_NOTIFICATIONS_ENABLED_KEY,
            label: "Notifications",
            description: "Notify when new breaking stories arrive, even while this pane is closed.",
            type: "toggle",
            storage: "plugin",
          },
          {
            key: BREAKING_NEWS_SCOPE_KEY,
            label: "Notify About",
            description: "Which breaking stories are worth interrupting you for.",
            type: "select",
            storage: "plugin",
            options: BREAKING_SCOPE_OPTIONS,
          },
          {
            key: BREAKING_NEWS_MUTED_SECTORS_KEY,
            label: "Muted Sectors",
            description: "Never notify about stories confined to these sectors.",
            type: "multi-select",
            storage: "plugin",
            options: BREAKING_MUTED_SECTOR_OPTIONS,
          },
        ],
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
    { id: "news-top-pane", paneId: "news-top", label: "Top News", description: "Highest-score wire stories from the last 4 hours", keywords: ["top", "news", "headlines", "stories", "wire"], shortcut: { prefix: "TOP" } },
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
    if (initialSettings.needsMigration) {
      void saveNewsFeedSettings(ctx.configState, initialSettings);
    }

    const source = createRssNewsCapability(
      () => getEnabledNewsFeeds(loadNewsFeedSettings(ctx.configState)),
      {
        persistence: ctx.persistence,
        tickerUniverse: async () => {
          void ensureUsListingsUniverse();
          const tickers = await ctx.tickerRepository.loadAllTickers();
          const listings = peekUsListingsUniverse();
          const universe = buildArticleTickerUniverse({
            book: tickers.map((ticker) => ({
              symbol: ticker.metadata.ticker,
              name: ticker.metadata.name,
            })),
            catalog: listings?.securities.map((security) => ({
              symbol: security.symbol,
              name: security.name,
            })) ?? [],
            catalogNames: false,
          });
          setSharedArticleTickerUniverse(universe);
          return universe;
        },
      },
    );
    ctx.registerCapability(source);
    disposeRssConnection = registerConnectionSource({
      id: "rss",
      name: "RSS Feeds",
      kind: "news",
      pluginId: "news",
      priority: 400,
      authRequired: false,
    });
    scheduleRssNewsWarm();
    disposeJinaConnection = registerConnectionSource({
      id: "jina-ai",
      name: "Jina",
      kind: "api",
      pluginId: "news",
      priority: 410,
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
      category: "data",
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
        const [newsArticles, adjacentArticles] = await Promise.all([
          loadNewsArticles(),
          searchAdjacentRelatedArticles(query),
        ]);
        const articles = [...newsArticles, ...adjacentArticles];
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
      id: "open-news-article",
      label: "Open Article",
      description: "Search loaded news headlines by topic, e.g. ART hormuz.",
      keywords: ["article", "news", "rss", "headline", "story", "open"],
      category: "navigation",
      shortcut: "ART",
      shortcutArg: {
        placeholder: "headline or topic",
        kind: "text",
        parse: (arg) => ({ query: arg.trim() }),
      },
      async execute(values) {
        const query = values?.query ?? values?.shortcut ?? "";
        const articles = cachedNewsArticles().length > 0
          ? cachedNewsArticles()
          : await loadNewsArticles();
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
        openUrl(match.url);
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
    cancelRssNewsWarm();
    disposeBreakingNewsNotifications?.();
    disposeBreakingNewsNotifications = null;
    disposeRssConnection?.();
    disposeRssConnection = null;
    disposeJinaConnection?.();
    disposeJinaConnection = null;
  },
};
