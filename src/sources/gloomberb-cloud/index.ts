import { assertTradingPriceHistory } from "../listing-history";
import type { TimeRange } from "../../time-series/range";
import {
  normalizeChartResolutionSupport,
  type ChartResolutionSupport,
  type ManualChartResolution,
} from "../../time-series/resolution";
import { aggregateTo4h } from "../../time-series/aggregate";
import { assetDataProvider, newsProvider, type PluginCapability } from "../../capabilities";
import type {
  AssetDataProvider,
  CachedFinancialsTarget,
  SecFilingDocument,
  SecFilingItem,
  MarketDataRequestContext,
  QuoteBatchResult,
  QuoteSubscriptionTarget,
  SearchRequestContext,
  TickerFinancialsBatchResult,
} from "../../types/data-provider";
import type { AnalystResearchData, CorporateActionsData, HolderData, OptionsChain, PricePoint, Quote, TickerFinancials } from "../../types/financials";
import type { InstrumentSearchResult } from "../../types/instrument";
import {
  apiClient,
  type CloudAnalystResearchPayload,
  type CloudCorporateActionsPayload,
  type CloudHoldersPayload,
  type CloudMarketResponse,
  type CloudPricePointPayload,
} from "../../api-client";
import type { NewsArticle, NewsQuery } from "../../types/news-source";
import { resolvePriceHistoryCurrencyUnit } from "../../utils/currency-units";
import { canonicalTickerKey, parsePublicTickerKey } from "../../utils/exchanges";
import { normalizePriceHistory } from "../../utils/price-history";
import { createProviderMiss } from "../provider-errors";
import { publicListingTarget } from "../listing-target";
import { tickerHasYahooSuffix } from "../yahoo-finance/symbols";
import { hasMalformedIntradayHistory } from "../../time-series/history-quality";
import {
  cloudNewsParams,
  mapCloudNewsArticle,
} from "./news";
import {
  GLOOMBERB_CLOUD_PROVIDER_ID,
  formatCloudDateTime,
  getRangeStartDate,
  isEmptyCloudStatus,
  mapBatchError,
  mapCloudFinancials,
  mapOptionsChain,
  mapPricePoint,
  mapQuote,
  toCloudInterval,
  toHistoryRequest,
} from "./normalizers";

const providerId = GLOOMBERB_CLOUD_PROVIDER_ID;
const CLOUD_RESOLUTION_SUPPORT = normalizeChartResolutionSupport([
  { resolution: "1m", maxRange: "1W" },
  { resolution: "5m", maxRange: "1M" },
  { resolution: "15m", maxRange: "3M" },
  { resolution: "30m", maxRange: "6M" },
  { resolution: "1h", maxRange: "1Y" },
  { resolution: "4h", maxRange: "1Y" },
  { resolution: "1d", maxRange: "5Y" },
  { resolution: "1wk", maxRange: "5Y" },
  { resolution: "1mo", maxRange: "ALL" },
]);
const CLOUD_PROVIDER_MISS_PATTERNS = [
  /data not found/i,
  /symbol.*missing or invalid/i,
  /figi.*missing or invalid/i,
  /error in the query/i,
];

function mapCloudSecFiling(item: {
  accessionNumber: string;
  form: string;
  filingDate: string;
  acceptedAt?: string;
  primaryDocument?: string;
  primaryDocDescription?: string;
  items?: string;
  cik: string;
  companyName?: string;
  filingUrl: string;
  primaryDocumentUrl?: string;
}): SecFilingItem {
  return {
    accessionNumber: item.accessionNumber,
    form: item.form,
    filingDate: new Date(`${item.filingDate}T00:00:00Z`),
    acceptedAt: item.acceptedAt ? new Date(item.acceptedAt) : undefined,
    primaryDocument: item.primaryDocument,
    primaryDocDescription: item.primaryDocDescription,
    items: item.items,
    cik: item.cik,
    companyName: item.companyName,
    filingUrl: item.filingUrl,
    primaryDocumentUrl: item.primaryDocumentUrl,
  };
}

function isCloudProviderMiss(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return CLOUD_PROVIDER_MISS_PATTERNS.some((pattern) => pattern.test(message));
}

async function withCloudFallback<T>(load: () => Promise<T>, message: string): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (isCloudProviderMiss(error)) {
      throw createProviderMiss(message);
    }
    throw error;
  }
}

function isStaleCloudResponse(response: CloudMarketResponse<unknown>): boolean {
  return response.stale === true || response.providerMeta?.stale === true;
}

function mapCloudPriceHistory(
  response: CloudMarketResponse<CloudPricePointPayload[]>,
  ticker: string,
  exchange: string,
  interval: string,
): PricePoint[] {
  if (isStaleCloudResponse(response)) {
    throw createProviderMiss(`Cloud chart data is stale for ${ticker}`);
  }
  const { divisor } = resolvePriceHistoryCurrencyUnit(
    response.currency ?? response.providerMeta?.currency,
    exchange,
  );
  const points = normalizePriceHistory(
    unwrapRequiredCloudResponse(
      response,
      `Cloud chart data is unavailable for ${ticker}`,
    ).map((point) => mapPricePoint(point, divisor, exchange)),
  );
  const upstream = (
    response.providerMeta?.provider
    ?? response.providerMeta?.upstream
    ?? ""
  ).trim().toLowerCase();
  if (
    /(min|h)$/i.test(interval)
    && upstream !== "yahoo"
    && hasMalformedIntradayHistory(points)
  ) {
    throw createProviderMiss(`Cloud chart data failed OHLC validation for ${ticker}`);
  }
  return assertTradingPriceHistory(points, { symbol: ticker, exchange }, "provider:gloomberb-cloud");
}

function quoteTargetKey(symbol: string, exchange?: string): string {
  const target = publicListingTarget(symbol, exchange);
  const base = target.exchange && tickerHasYahooSuffix(target.symbol)
    ? target.symbol.slice(0, target.symbol.indexOf("."))
    : target.symbol;
  return canonicalTickerKey(base, target.exchange);
}

function cloudResponseTargetKey(key: string, requested: Set<string>): string | undefined {
  if (requested.has(key)) return key;
  const symbol = parsePublicTickerKey(key).symbol;
  // A venue-less request may discover one listing. Never guess between two
  // requested listings or erase an unresolved suffix to make it match.
  return requested.has(symbol) && [...requested].filter((candidate) => parsePublicTickerKey(candidate).symbol === symbol).length === 1
    ? symbol : undefined;
}

const cloudInstrumentTarget = publicListingTarget;

function cloudBatchTargets<T extends { symbol: string; exchange?: string }>(targets: T[]) {
  const valid: Array<{ target: T; request: ReturnType<typeof cloudInstrumentTarget> }> = [];
  const invalid: Array<{ target: T; error: unknown }> = [];
  for (const target of targets) {
    try { valid.push({ target, request: cloudInstrumentTarget(target.symbol, target.exchange) }); }
    catch (error) { invalid.push({ target, error }); }
  }
  return { valid, invalid };
}

function matchCloudBatchItems<T extends { symbol: string; exchange?: string }, I extends { symbol: string; exchange?: string }>(targets: T[], items: I[]) {
  const pending = new Map<string, T[]>();
  for (const target of targets) {
    const key = quoteTargetKey(target.symbol, target.exchange);
    pending.set(key, [...(pending.get(key) ?? []), target]);
  }
  const matched: Array<{ target: T; item: I }> = [];
  const requested = new Set(pending.keys());
  const responses = items.flatMap((item) => {
    try { return [{ item, key: quoteTargetKey(item.symbol, item.exchange) }]; }
    catch { return []; }
  });
  for (const { item, key: responseKey } of responses) {
    const key = cloudResponseTargetKey(responseKey, requested);
    if (!key) continue;
    if (key !== responseKey && new Set(responses.filter((response) => parsePublicTickerKey(response.key).symbol === key).map((response) => response.key)).size !== 1) continue;
    for (const target of pending.get(key) ?? []) matched.push({ target, item });
    pending.delete(key);
  }
  return { matched, missing: [...pending.values()].flat() };
}

function retainRequestedQuoteSymbol(quote: Quote, ticker: string): Quote {
  return parsePublicTickerKey(ticker).exchange || tickerHasYahooSuffix(ticker) ? { ...quote, symbol: ticker } : quote;
}

function retainRequestedFinancialsSymbol(financials: TickerFinancials, ticker: string): TickerFinancials {
  return financials.quote
    ? { ...financials, quote: retainRequestedQuoteSymbol(financials.quote, ticker) }
    : financials;
}

async function requireVerifiedSession(): Promise<void> {
  const user = await apiClient.ensureVerifiedSession();
  if (!user) {
    throw createProviderMiss("Gloom Cloud requires signup and email verification");
  }
}

function unwrapRequiredCloudResponse<T>(response: CloudMarketResponse<T>, message: string): T {
  if ((response.status === "success" || response.status === "partial") && response.data != null) {
    return response.data;
  }
  if (isEmptyCloudStatus(response.status)) {
    throw createProviderMiss(response.reasonCode ?? message);
  }
  throw new Error(response.reasonCode ?? message);
}

export class GloomberbCloudProvider implements AssetDataProvider {
  readonly id = providerId;
  readonly name = "Gloom Cloud";
  readonly priority = 100;

  getChartResolutionSupport(): ChartResolutionSupport[] {
    return CLOUD_RESOLUTION_SUPPORT;
  }

  getChartResolutionCapabilities(): ManualChartResolution[] {
    return CLOUD_RESOLUTION_SUPPORT.map((entry) => entry.resolution);
  }

  async canProvide(): Promise<boolean> {
    return true;
  }

  async getTickerFinancials(ticker: string, exchange = "", _context?: MarketDataRequestContext): Promise<TickerFinancials> {
    const target = cloudInstrumentTarget(ticker, exchange);
    return withCloudFallback(async () => {
      const response = await apiClient.getCloudFinancials(target.symbol, target.exchange);
      if (isStaleCloudResponse(response)) {
        throw createProviderMiss(`Cloud financials are stale for ${ticker}`);
      }
      return retainRequestedFinancialsSymbol(mapCloudFinancials(
        unwrapRequiredCloudResponse(response, `Cloud financials are unavailable for ${ticker}`),
        response.providerMeta,
        target,
      ), ticker);
    }, `Cloud financials are unavailable for ${ticker}`);
  }

  async getTickerFinancialsBatch(
    targets: CachedFinancialsTarget[],
    options: { forceRefresh?: boolean } = {},
  ): Promise<TickerFinancialsBatchResult[]> {
    const { valid, invalid } = cloudBatchTargets(targets);
    const rejected = invalid.map((entry) => ({ ...entry, financials: null as TickerFinancials | null }));
    if (!valid.length) {
      const byTarget = new Map(rejected.map((entry) => [entry.target, entry] as const));
      return targets.map((target) => byTarget.get(target) ?? { target, financials: null });
    }
    const submitted = valid.map((entry) => entry.target);
    return withCloudFallback(async () => {
      const response = await apiClient.getCloudFinancialsBatch(
        valid.map((entry) => entry.request),
        options.forceRefresh ? "refresh" : "cache-first",
      );
      if (isStaleCloudResponse(response)) {
        throw createProviderMiss("Cloud financials are stale");
      }
      const payload = unwrapRequiredCloudResponse(response, "Cloud financials are unavailable");
      const { matched, missing } = matchCloudBatchItems(submitted, payload.items);
      const byTarget = new Map<CachedFinancialsTarget, TickerFinancialsBatchResult>();
      for (const entry of rejected) byTarget.set(entry.target, entry);
      for (const { target, item } of matched) {
        if ((item.status === "success" || item.status === "partial") && item.data) {
          byTarget.set(target, {
            target,
            financials: retainRequestedFinancialsSymbol(
              mapCloudFinancials(item.data, undefined, cloudInstrumentTarget(target.symbol, target.exchange)),
              target.symbol,
            ),
          });
          continue;
        }
        byTarget.set(target, {
          target,
          financials: null,
          error: mapBatchError(item, `Cloud financials are unavailable for ${target.symbol}`),
        });
      }
      for (const target of missing) {
        byTarget.set(target, {
          target,
          financials: null,
          error: createProviderMiss(`Cloud financials are unavailable for ${target.symbol}`),
        });
      }
      return targets.map((target) => byTarget.get(target) ?? { target, financials: null });
    }, "Cloud financials are unavailable");
  }

  async getQuote(ticker: string, exchange = "", _context?: MarketDataRequestContext): Promise<Quote> {
    const target = cloudInstrumentTarget(ticker, exchange);
    return withCloudFallback(
      async () => {
        const response = await apiClient.getCloudQuote(target.symbol, target.exchange);
        if (isStaleCloudResponse(response)) {
          throw createProviderMiss(`Cloud quotes are stale for ${ticker}`);
        }
        return retainRequestedQuoteSymbol(mapQuote(
          unwrapRequiredCloudResponse(response, `Cloud quotes are unavailable for ${ticker}`),
          response.providerMeta,
        ), ticker);
      },
      `Cloud quotes are unavailable for ${ticker}`,
    );
  }

  async getQuotesBatch(
    targets: QuoteSubscriptionTarget[],
    options: { forceRefresh?: boolean } = {},
  ): Promise<QuoteBatchResult[]> {
    const { valid, invalid } = cloudBatchTargets(targets);
    const rejected = invalid.map((entry) => ({ ...entry, quote: null as Quote | null }));
    if (!valid.length) {
      const byTarget = new Map(rejected.map((entry) => [entry.target, entry] as const));
      return targets.map((target) => byTarget.get(target) ?? { target, quote: null });
    }
    const submitted = valid.map((entry) => entry.target);
    return withCloudFallback(async () => {
      const response = await apiClient.getCloudQuotesBatch(
        valid.map((entry) => entry.request),
        options.forceRefresh ? "refresh" : "cache-first",
      );
      if (isStaleCloudResponse(response)) {
        throw createProviderMiss("Cloud quotes are stale");
      }
      const payload = unwrapRequiredCloudResponse(response, "Cloud quotes are unavailable");
      const { matched, missing } = matchCloudBatchItems(submitted, payload.items);
      const byTarget = new Map<QuoteSubscriptionTarget, QuoteBatchResult>();
      for (const entry of rejected) byTarget.set(entry.target, entry);
      for (const { target, item } of matched) {
        // A successful batch can contain an expired cache fallback for only
        // one listing. Match the single-quote freshness boundary and let the
        // normal router retry that item without discarding its healthy peers.
        if (item.stale === true) {
          byTarget.set(target, {
            target,
            quote: null,
            error: createProviderMiss(`Cloud quotes are stale for ${target.symbol}`),
          });
          continue;
        }
        if ((item.status === "success" || item.status === "partial") && item.data) {
          byTarget.set(target, {
            target,
            quote: retainRequestedQuoteSymbol(mapQuote(item.data), target.symbol),
          });
          continue;
        }
        byTarget.set(target, {
          target,
          quote: null,
          error: mapBatchError(item, `Cloud quotes are unavailable for ${target.symbol}`),
        });
      }
      for (const target of missing) {
        byTarget.set(target, {
          target,
          quote: null,
          error: createProviderMiss(`Cloud quotes are unavailable for ${target.symbol}`),
        });
      }
      return targets.map((target) => byTarget.get(target) ?? { target, quote: null });
    }, "Cloud quotes are unavailable");
  }

  async getExchangeRate(fromCurrency: string): Promise<number> {
    const response = await apiClient.getCloudExchangeRate(fromCurrency);
    return unwrapRequiredCloudResponse(response, `Cloud exchange rate is unavailable for ${fromCurrency}`).rate;
  }

  async search(query: string, _context?: SearchRequestContext): Promise<InstrumentSearchResult[]> {
    return withCloudFallback(
      () => apiClient.searchInstruments(query, 10),
      "Cloud search is unavailable",
    );
  }

  async getSecFilings(ticker: string, count = 15): Promise<SecFilingItem[]> {
    await requireVerifiedSession();
    return withCloudFallback(async () => {
      const response = await apiClient.getCloudSecFilings({ ticker, limit: count, offset: 0 });
      return response.filings.map(mapCloudSecFiling);
    }, `Cloud SEC filings are unavailable for ${ticker}`);
  }

  async getSecFilingDocuments(filing: SecFilingItem): Promise<SecFilingDocument[]> {
    await requireVerifiedSession();
    return withCloudFallback(async () => {
      const response = await apiClient.getCloudSecFilingDocuments({
        cik: filing.cik,
        accession: filing.accessionNumber,
        form: filing.form,
        primaryDocument: filing.primaryDocument,
        filingUrl: filing.filingUrl,
      });
      return response.documents;
    }, "Cloud SEC filing documents are unavailable");
  }

  async getSecFilingContent(filing: SecFilingItem): Promise<string | null> {
    await requireVerifiedSession();
    return withCloudFallback(async () => {
      const response = await apiClient.getCloudSecFilingContent({
        cik: filing.cik,
        accession: filing.accessionNumber,
        form: filing.form,
        primaryDocument: filing.primaryDocument,
        primaryDocumentUrl: filing.primaryDocumentUrl,
        filingUrl: filing.filingUrl,
      });
      return response.content;
    }, "Cloud SEC filing content is unavailable");
  }

  async getHolders(ticker: string, exchange = "", _context?: MarketDataRequestContext): Promise<HolderData> {
    const target = cloudInstrumentTarget(ticker, exchange);
    await requireVerifiedSession();
    return withCloudFallback(async () => {
      const response = await apiClient.getCloudHolders(target.symbol, target.exchange);
      return unwrapRequiredCloudResponse(response, `Cloud holders are unavailable for ${ticker}`) as CloudHoldersPayload;
    }, `Cloud holders are unavailable for ${ticker}`);
  }

  async getAnalystResearch(ticker: string, exchange = "", _context?: MarketDataRequestContext): Promise<AnalystResearchData> {
    const target = cloudInstrumentTarget(ticker, exchange);
    await requireVerifiedSession();
    return withCloudFallback(async () => {
      const response = await apiClient.getCloudAnalystResearch(target.symbol, target.exchange);
      return unwrapRequiredCloudResponse(response, `Cloud analyst research is unavailable for ${ticker}`) as CloudAnalystResearchPayload;
    }, `Cloud analyst research is unavailable for ${ticker}`);
  }

  async getCorporateActions(ticker: string, exchange = "", _context?: MarketDataRequestContext): Promise<CorporateActionsData> {
    const target = cloudInstrumentTarget(ticker, exchange);
    await requireVerifiedSession();
    return withCloudFallback(async () => {
      const response = await apiClient.getCloudCorporateActions(target.symbol, target.exchange);
      return unwrapRequiredCloudResponse(response, `Cloud corporate actions are unavailable for ${ticker}`) as CloudCorporateActionsPayload;
    }, `Cloud corporate actions are unavailable for ${ticker}`);
  }

  async getArticleSummary(_url: string): Promise<string | null> {
    throw createProviderMiss("Cloud article summaries are not available");
  }

  async getPriceHistory(ticker: string, exchange: string, range: TimeRange, _context?: MarketDataRequestContext): Promise<PricePoint[]> {
    const target = cloudInstrumentTarget(ticker, exchange);
    const listing = target.exchange ?? "";
    const request = toHistoryRequest(range);
    const response = await withCloudFallback(
      () => apiClient.getCloudHistory(target.symbol, listing, request),
      `Cloud chart data is unavailable for ${ticker}`,
    );
    return mapCloudPriceHistory(response, ticker, listing, request.interval);
  }

  async getPriceHistoryForResolution(
    ticker: string,
    exchange: string,
    bufferRange: TimeRange,
    resolution: ManualChartResolution,
    _context?: MarketDataRequestContext,
  ): Promise<PricePoint[]> {
    const target = cloudInstrumentTarget(ticker, exchange);
    const listing = target.exchange ?? "";
    const sourceResolution: ManualChartResolution = resolution === "4h" ? "1h" : resolution;
    const interval = toCloudInterval(sourceResolution);
    const endDate = new Date();
    const startDate = getRangeStartDate(bufferRange, endDate);
    const includeTime = /(min|h)$/i.test(interval);
    const response = await withCloudFallback(
      () => apiClient.getCloudHistory(target.symbol, listing, {
        interval,
        startDate: formatCloudDateTime(startDate, includeTime, listing),
        endDate: formatCloudDateTime(endDate, includeTime, listing),
      }),
      `Cloud chart data is unavailable for ${ticker}`,
    );
    const points = mapCloudPriceHistory(response, ticker, listing, interval);
    return resolution === "4h" ? aggregateTo4h(points) : points;
  }

  async getDetailedPriceHistory(
    ticker: string,
    exchange: string,
    startDate: Date,
    endDate: Date,
    barSize: string,
    _context?: MarketDataRequestContext,
  ): Promise<PricePoint[]> {
    const target = cloudInstrumentTarget(ticker, exchange);
    const listing = target.exchange ?? "";
    const sourceBarSize = barSize === "4h" ? "1h" : barSize;
    const interval = toCloudInterval(sourceBarSize);
    const includeTime = /(min|h)$/i.test(interval);
    const response = await withCloudFallback(
      () => apiClient.getCloudHistory(target.symbol, listing, {
        interval,
        startDate: formatCloudDateTime(startDate, includeTime, listing),
        endDate: formatCloudDateTime(endDate, includeTime, listing),
      }),
      `Cloud detailed chart history is unavailable for ${ticker}`,
    );
    const points = mapCloudPriceHistory(response, ticker, listing, interval);
    return barSize === "4h" ? aggregateTo4h(points) : points;
  }

  async getOptionsChain(ticker: string, exchange?: string, expirationDate?: number, _context?: MarketDataRequestContext): Promise<OptionsChain> {
    const target = cloudInstrumentTarget(ticker, exchange);
    return withCloudFallback(async () => {
      const response = await apiClient.getCloudOptionsChain(target.symbol, target.exchange, expirationDate);
      const chain = unwrapRequiredCloudResponse(
        response,
        `Cloud options chains are unavailable for ${ticker}`,
      );
      return mapOptionsChain(chain);
    }, `Cloud options chains are unavailable for ${ticker}`);
  }

  subscribeQuotes(
    targets: QuoteSubscriptionTarget[],
    onQuote: (target: QuoteSubscriptionTarget, quote: Quote) => void,
  ): () => void {
    const { valid } = cloudBatchTargets(targets);
    if (!valid.length) return () => {};
    // No-op without a session credential; covers browser cookie sessions too.
    void apiClient.ensureVerifiedSession().catch(() => {});
    const targetMap = new Map<string, QuoteSubscriptionTarget[]>();
    for (const { target } of valid) {
      const key = quoteTargetKey(target.symbol, target.exchange);
      const matches = targetMap.get(key) ?? [];
      matches.push(target);
      targetMap.set(key, matches);
    }
    const requested = new Set(targetMap.keys());

    return apiClient.subscribeQuotes(
      valid.map(({ target, request }) => ({
        ...request,
        surface: target.surface,
        visible: target.visible,
        selected: target.selected,
        weight: target.weight,
      })),
      (target, quote) => {
        let key: string;
        try { key = quoteTargetKey(target.symbol, target.exchange); }
        catch { return; }
        const matchedKey = cloudResponseTargetKey(key, requested);
        const matches = matchedKey ? targetMap.get(matchedKey) ?? [] : [];
        const mappedQuote = mapQuote(quote);
        for (const match of matches) {
          onQuote(match, retainRequestedQuoteSymbol(mappedQuote, match.symbol));
        }
      },
    );
  }
}

export function createGloomberbCloudProvider(): AssetDataProvider {
  return new GloomberbCloudProvider();
}

export function createGloomberbCloudCapabilities(provider = createGloomberbCloudProvider()): PluginCapability[] {
  return [
    assetDataProvider(provider),
    newsProvider({
      id: providerId,
      name: "Gloom Cloud",
      priority: 10,
      provider: {
        supports(query: NewsQuery): boolean {
          const feed = query.feed ?? (query.scope === "ticker" ? "ticker" : "latest");
          return feed === "ticker" ? !!query.ticker : true;
        },
        async fetchNewsPage(query: NewsQuery) {
          const response = await withCloudFallback(
            () => apiClient.getCloudNews(cloudNewsParams(query)),
            "Cloud news is unavailable",
          );
          return {
            articles: response.items.map((item) => mapCloudNewsArticle(item, query.ticker)),
            nextCursor: response.nextCursor ?? null,
          };
        },
        async fetchNews(query: NewsQuery): Promise<NewsArticle[]> {
          const response = await withCloudFallback(
            () => apiClient.getCloudNews(cloudNewsParams(query)),
            "Cloud news is unavailable",
          );
          return response.items.map((item) => mapCloudNewsArticle(item, query.ticker));
        },
        async fetchNewsStory(storyId: string): Promise<NewsArticle | null> {
          const story = await withCloudFallback(
            () => apiClient.getCloudNewsStory(storyId),
            "Cloud news story is unavailable",
          );
          return mapCloudNewsArticle(story);
        },
      },
    }),
  ];
}
