import type { CloudNewsListResponse } from "../../../api-client";
import type {
  HeadlessPaneContext,
  HeadlessPaneDefinition,
  HeadlessPaneLoadArgs,
  HeadlessSnapshotResult,
} from "../../../types/plugin";
import type { NewsArticle, NewsQuery } from "../../../news/types";
import {
  cloudNewsParams,
  mapCloudNewsArticle,
} from "../../../sources/gloomberb-cloud/news";
import { parsePublicTickerKey } from "../../../utils/exchanges";
import { NEWS_QUERY_PRESETS, parseNewsIndustryCode } from "./wire/news/query-presets";

const NEWS_COLUMNS = [
  { key: "publishedAt", header: "Published" },
  { key: "source", header: "Source" },
  { key: "headline", header: "Headline" },
  { key: "tickers", header: "Tickers" },
  { key: "sentiment", header: "Sentiment" },
  { key: "importance", header: "Score", align: "right" as const },
];

export interface NewsHeadlessDependencies {
  loadNews(
    query: NewsQuery,
    context: HeadlessPaneContext,
  ): Promise<CloudNewsListResponse>;
  now(): Date;
}

const defaultDependencies: NewsHeadlessDependencies = {
  loadNews: (query, context) => context.apiClient.getCloudNews(cloudNewsParams(query)),
  now: () => new Date(),
};

function newsRow(article: NewsArticle) {
  return {
    id: article.id,
    publishedAt: article.publishedAt.toISOString(),
    source: article.source,
    headline: article.title,
    summary: article.summary ?? null,
    topic: article.topic,
    topics: article.topics,
    sectors: article.sectors,
    categories: article.categories,
    tickers: article.tickers,
    sentiment: article.sentiment ?? null,
    importance: article.scores.importance,
    urgency: article.scores.urgency,
    marketImpact: article.scores.marketImpact,
    novelty: article.scores.novelty,
    confidence: article.scores.confidence,
    breaking: article.isBreaking,
    developing: article.isDeveloping,
    sourceCount: article.sourceCount ?? article.items?.length ?? 0,
    url: article.url,
  };
}

function selectedSentiment(args: HeadlessPaneLoadArgs): string {
  return String(args.options.sentiment ?? "any");
}

type NewsHeadlessSort = "time" | "rank" | "importance";

function orderNewsStories(articles: NewsArticle[], sort: NewsHeadlessSort): NewsArticle[] {
  // Rank is the feed order. Top News is already ranked, and a time sort undoes it.
  if (sort === "rank") return articles;
  if (sort === "importance") {
    // Ties keep feed order; Array#sort is stable.
    return [...articles].sort((left, right) => right.importance - left.importance);
  }
  return [...articles].sort((left, right) => right.publishedAt.getTime() - left.publishedAt.getTime());
}

function projectNewsHeadless(
  response: CloudNewsListResponse,
  args: HeadlessPaneLoadArgs,
  now: Date,
  sort: NewsHeadlessSort = "time",
  defaultLimit = 50,
): HeadlessSnapshotResult {
  const sentiment = selectedSentiment(args);
  const minImportance = Number(args.options.minImportance ?? 0);
  const limit = Number(args.options.limit ?? defaultLimit);
  const matching = response.items
    .map((item) => mapCloudNewsArticle(item, args.symbols[0]))
    .filter((article) => sentiment === "any" || article.sentiment === sentiment)
    .filter((article) => article.importance >= minImportance);
  const items = orderNewsStories(matching, sort).slice(0, limit).map(newsRow);

  return {
    asOf: now.toISOString(),
    items,
    metadata: {
      nextCursor: response.nextCursor,
      sentiment,
      minImportance,
      total: matching.length,
      returned: items.length,
      truncated: items.length < matching.length || response.nextCursor != null,
    },
  };
}

function newsOptions(defaultLimit = 50) {
  return [
    {
      key: "sentiment",
      description: "Story sentiment to include.",
      type: "enum" as const,
      values: [
        { value: "any" },
        { value: "positive" },
        { value: "neutral" },
        { value: "negative" },
      ],
      defaultValue: "any",
    },
    {
      key: "minImportance",
      aliases: ["importance"],
      description: "Minimum importance score.",
      type: "integer" as const,
      defaultValue: 0,
      minimum: 0,
      maximum: 100,
    },
    {
      key: "limit",
      description: "Maximum stories to return.",
      type: "integer" as const,
      defaultValue: defaultLimit,
      minimum: 1,
      maximum: 200,
    },
  ];
}

/**
 * A bare symbol listed on several exchanges is ambiguous to the news service.
 * The pane asks with the saved listing's exchange, so the report does too.
 */
async function resolveTicker(
  args: HeadlessPaneLoadArgs,
  context: HeadlessPaneContext,
): Promise<{ symbol: string; exchange?: string } | null> {
  const key = args.symbols[0];
  if (!key) return null;
  const parsed = parsePublicTickerKey(key);
  if (parsed.exchange || !context.resolveInstrument) return parsed;
  const saved = await context.resolveInstrument(key);
  return { symbol: parsed.symbol, exchange: saved.exchange || undefined };
}

function queryFor(
  args: HeadlessPaneLoadArgs,
  feed: "latest" | "ticker" | NewsQuery,
  ticker: { symbol: string; exchange?: string } | null = null,
): NewsQuery {
  const base: NewsQuery = typeof feed === "string" ? { feed } : { ...feed };
  const sentiment = selectedSentiment(args);
  return {
    ...base,
    ...(base.feed === "ticker"
      ? {
          ticker: ticker?.symbol,
          exchange: ticker?.exchange,
          tickerTier: "primary" as const,
        }
      : {}),
    ...(sentiment === "any" ? {} : { sentiment: sentiment as "positive" | "neutral" | "negative" }),
    minImportance: Number(args.options.minImportance ?? 0),
    // A preset limit is only the default. The tool limit is the page size.
    limit: Number(args.options.limit ?? base.limit ?? 50),
  };
}

export function createNewsFeedHeadless(
  dependencies: NewsHeadlessDependencies = defaultDependencies,
): HeadlessPaneDefinition<"snapshot"> {
  return {
    shape: "snapshot",
    argument: { kind: "none" },
    options: newsOptions(),
    columns: NEWS_COLUMNS,
    describe: "Firehose",
    async load(args, context) {
      return projectNewsHeadless(
        await dependencies.loadNews(queryFor(args, "latest"), context),
        args,
        dependencies.now(),
      );
    },
  };
}

export function createTickerNewsHeadless(
  dependencies: NewsHeadlessDependencies = defaultDependencies,
): HeadlessPaneDefinition<"snapshot"> {
  return {
    shape: "snapshot",
    argument: {
      kind: "ticker",
      placeholder: "ticker",
      description: "Company symbol, optionally qualified as SYMBOL:EXCHANGE.",
    },
    options: newsOptions(),
    columns: NEWS_COLUMNS,
    describe: (args) => `Ticker News | ${String(args.argument)}`,
    async load(args, context) {
      return projectNewsHeadless(
        await dependencies.loadNews(
          queryFor(args, "ticker", await resolveTicker(args, context)),
          context,
        ),
        args,
        dependencies.now(),
      );
    },
  };
}

export function createTopNewsHeadless(
  dependencies: NewsHeadlessDependencies = defaultDependencies,
): HeadlessPaneDefinition<"snapshot"> {
  return {
    shape: "snapshot",
    argument: { kind: "none" },
    options: newsOptions(NEWS_QUERY_PRESETS.top.limit),
    columns: NEWS_COLUMNS,
    describe: "Top News",
    async load(args, context) {
      const query = queryFor(args, NEWS_QUERY_PRESETS.top);
      return projectNewsHeadless(
        await dependencies.loadNews(query, context),
        args,
        dependencies.now(),
        "rank",
        query.limit,
      );
    },
  };
}

export function createBreakingNewsHeadless(
  dependencies: NewsHeadlessDependencies = defaultDependencies,
): HeadlessPaneDefinition<"snapshot"> {
  return {
    shape: "snapshot",
    argument: { kind: "none" },
    options: newsOptions(NEWS_QUERY_PRESETS.breaking.limit),
    columns: NEWS_COLUMNS,
    describe: "Breaking News",
    async load(args, context) {
      const query = queryFor(args, NEWS_QUERY_PRESETS.breaking);
      return projectNewsHeadless(
        await dependencies.loadNews(query, context),
        args,
        dependencies.now(),
        "importance",
        query.limit,
      );
    },
  };
}

function topicArgument(args: HeadlessPaneLoadArgs): string {
  return typeof args.argument === "string" ? args.argument.trim() : "";
}

function describeTopicNews(args: HeadlessPaneLoadArgs): string {
  const code = topicArgument(args);
  if (!code) return "Topic News";
  return `Topic News | ${parseNewsIndustryCode(code)?.code ?? code.toUpperCase()}`;
}

/** Empty and ALL read every sector. An unknown code is rejected instead of queried. */
function industryPreset(code: string): NewsQuery | null {
  if (!code) return NEWS_QUERY_PRESETS.sectorAll;
  const entry = parseNewsIndustryCode(code);
  if (!entry) return null;
  if (entry.topic) return NEWS_QUERY_PRESETS.topic(entry.topic);
  if (entry.sector) return NEWS_QUERY_PRESETS.sector(entry.sector);
  return NEWS_QUERY_PRESETS.sectorAll;
}

function rejectedTopicSnapshot(
  code: string,
  args: HeadlessPaneLoadArgs,
  now: Date,
): HeadlessSnapshotResult {
  return {
    asOf: now.toISOString(),
    items: [],
    metadata: {
      code,
      sentiment: selectedSentiment(args),
      minImportance: Number(args.options.minImportance ?? 0),
      total: 0,
      returned: 0,
      truncated: false,
    },
  };
}

export function createTopicNewsHeadless(
  dependencies: NewsHeadlessDependencies = defaultDependencies,
): HeadlessPaneDefinition<"snapshot"> {
  return {
    shape: "snapshot",
    argument: {
      kind: "free-text",
      optional: true,
      placeholder: "code",
      description: "Topic or sector code, such as MNA, CB, ENERGY, or TECH.",
    },
    options: newsOptions(NEWS_QUERY_PRESETS.sectorAll.limit),
    columns: NEWS_COLUMNS,
    describe: describeTopicNews,
    async load(args, context) {
      const code = topicArgument(args);
      const preset = industryPreset(code);
      if (!preset) return rejectedTopicSnapshot(code, args, dependencies.now());
      const query = queryFor(args, preset);
      return projectNewsHeadless(
        await dependencies.loadNews(query, context),
        args,
        dependencies.now(),
        "time",
        query.limit,
      );
    },
  };
}

export const newsFeedHeadless = createNewsFeedHeadless();
export const tickerNewsHeadless = createTickerNewsHeadless();
export const topNewsHeadless = createTopNewsHeadless();
export const breakingNewsHeadless = createBreakingNewsHeadless();
export const topicNewsHeadless = createTopicNewsHeadless();
