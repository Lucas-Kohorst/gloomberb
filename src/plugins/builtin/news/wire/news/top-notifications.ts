import type { GloomPluginContext } from "../../../../../types/plugin";
import type { MarketNewsItem, NewsQueryState } from "../../../../../types/news-source";
import { newsPollIntervalMsFromMinutes } from "../../../../../news/poll-interval";
import { openNewsArticle } from "../article-search";
import { NEWS_QUERY_PRESETS } from "./query-presets";

const MAX_SEEN_ARTICLE_IDS = 500;
const TOP_NEWS_TOAST_DURATION_MS = 15_000;
const DEFAULT_TOP_NEWS_POLL_INTERVAL_MS = 15 * 60 * 1000;

function isReadyState(state: NewsQueryState): boolean {
  return state.phase === "ready" || state.phase === "refreshing";
}

function rememberArticleIds(current: Set<string>, articles: MarketNewsItem[]): Set<string> {
  const next: string[] = [];
  const included = new Set<string>();

  for (const article of articles) {
    if (included.has(article.id)) continue;
    included.add(article.id);
    next.push(article.id);
  }

  for (const id of current) {
    if (included.has(id)) continue;
    included.add(id);
    next.push(id);
    if (next.length >= MAX_SEEN_ARTICLE_IDS) break;
  }

  return new Set(next.slice(0, MAX_SEEN_ARTICLE_IDS));
}

function notificationSubtitle(article: MarketNewsItem): string {
  const tickers = article.tickers.slice(0, 3).join(" ");
  return tickers ? `${article.source} ${tickers}` : article.source;
}

function pickHeadline(articles: MarketNewsItem[]): MarketNewsItem | null {
  if (articles.length === 0) return null;
  return [...articles].sort((left, right) => {
    const importance = (right.importance ?? 0) - (left.importance ?? 0);
    if (importance !== 0) return importance;
    return right.publishedAt.getTime() - left.publishedAt.getTime();
  })[0] ?? null;
}

function topNewsPollIntervalMs(ctx: GloomPluginContext): number {
  const minutes = ctx.getConfig?.().refreshIntervalMinutes;
  return typeof minutes === "number" && Number.isFinite(minutes)
    ? newsPollIntervalMsFromMinutes(minutes)
    : DEFAULT_TOP_NEWS_POLL_INTERVAL_MS;
}

function articlesPublishedInPollWindow(
  articles: MarketNewsItem[],
  pollCompletedAt: number | null,
  pollIntervalMs: number,
): MarketNewsItem[] {
  if (!Number.isFinite(pollCompletedAt)) return [];
  return articles.filter((article) => {
    const ageMs = pollCompletedAt! - article.publishedAt.getTime();
    return ageMs >= 0 && ageMs <= pollIntervalMs;
  });
}

export function setupTopNewsNotifications(ctx: GloomPluginContext): () => void {
  let disposeWatch: (() => void) | null = null;
  let primed = false;
  let seenArticleIds = new Set<string>();

  const notifyNewTopArticles = (articles: MarketNewsItem[]): void => {
    const headline = pickHeadline(articles);
    if (!headline) return;
    const extraCount = articles.length - 1;
    ctx.notify({
      title: "Top News",
      subtitle: notificationSubtitle(headline),
      body: extraCount > 0 ? `${headline.title} (+${extraCount} more)` : headline.title,
      type: "info",
      desktop: "always",
      duration: TOP_NEWS_TOAST_DURATION_MS,
      action: {
        label: "Open",
        onClick: () => openNewsArticle(headline, ctx.createPaneFromTemplate),
      },
    });
  };

  const handleState = (state: NewsQueryState) => {
    if (!isReadyState(state)) return;

    if (!primed) {
      seenArticleIds = rememberArticleIds(seenArticleIds, state.articles);
      primed = true;
      return;
    }

    const freshArticles = articlesPublishedInPollWindow(
      state.articles.filter((article) => !seenArticleIds.has(article.id)),
      state.updatedAt,
      topNewsPollIntervalMs(ctx),
    );
    seenArticleIds = rememberArticleIds(seenArticleIds, state.articles);
    if (freshArticles.length === 0) return;
    notifyNewTopArticles(freshArticles);
  };

  if (!ctx.watchNewsQuery) {
    ctx.log.warn("top news notifications unavailable: news query watcher missing");
    return () => {};
  }

  disposeWatch = ctx.watchNewsQuery(NEWS_QUERY_PRESETS.top, handleState);

  return () => {
    disposeWatch?.();
    disposeWatch = null;
    primed = false;
    seenArticleIds = new Set();
  };
}
