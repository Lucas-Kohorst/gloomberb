import type { TickerFinancials } from "../types/financials";
import type { InstrumentSearchResult } from "../types/instrument";
import { companyDisclosurePath } from "./company-kpis";
import { supplyGraphQuery } from "./supply-chain-graph";
import {
  normalizeSavedSearchHits,
  normalizeSavedSearchResponse,
  normalizeSearchResponse,
  normalizeTweetSearchResponse,
} from "./normalizers";
import {
  cloudCdsHistoryPath,
  cloudCdsPath,
  cloudCongressHousePath,
  cloudCreditBoardPath,
  cloudJobsMoversPath,
  cloudJobsPath,
  cloudJobsPostingsPath,
  cloudEarningsCallsPath,
  cloudEarningsTranscriptPath,
  cloudExchangeRatePath,
  cloudSec13FPath,
  cloudSecFilingContentPath,
  cloudSecFilingDocumentsPath,
  cloudSecFilingsPath,
  cloudFredSeriesPath,
  cloudShillerPath,
  cloudHistoryPath,
  cloudMarketSearchPath,
  cloudMarketSymbolPath,
  cloudNewsPath,
  cloudOptionsChainPath,
  publicProxyStatementPath,
  publicProxyStatementsPath,
  cloudSavedSearchHitsPath,
  cloudSavedSearchPath,
  cloudSavedSearchesPath,
  cloudSearchDocumentPath,
  cloudSearchPath,
  cloudStatementsPath,
  cloudTickerTweetsPath,
  cloudTweetSearchPath,
  type CloudCdsParams,
  type CloudCongressHouseParams,
  type CloudEarningsCallsParams,
  type CloudFredSeriesParams,
  type CloudHistoryParams,
  type CloudNewsParams,
  type CloudSearchParams,
  type CloudSecFilingParams,
  type CloudSecFilingsParams,
  type CloudTickerTweetsParams,
  type CloudTweetSearchParams,
} from "./paths";
import type {
  CloudAnalystResearchPayload,
  CloudShortInterestPayload,
  CloudCdsResponse,
  CloudCompanyProfile,
  CloudCongressHousePayload,
  CloudEarningsCallListPayload,
  CloudEarningsTranscriptPayload,
  CloudCorporateActionsPayload,
  CloudEconEventPayload,
  CloudEquityDiagnosticMode,
  CloudEquityDiagnosticResult,
  CloudFinancialsPayload,
  CloudFredSeriesPayload,
  CloudShillerPayload,
  CloudFundamentals,
  CloudHoldersPayload,
  CloudMarketBatchPayload,
  CloudMarketBatchTarget,
  CloudMarketResponse,
  CloudMarketScreenerCategory,
  CloudMarketScreenerPayload,
  CloudNewsListResponse,
  CloudNewsPayload,
  CloudProxyStatementListPayload,
  CloudProxyStatementPayload,
  CloudSavedSearch,
  CloudSavedSearchInput,
  CloudSavedSearchListResponse,
  CloudSearchDocType,
  CloudSearchDocument,
  CloudSearchDocumentResponse,
  CloudSearchHit,
  CloudSearchResponse,
  CloudSecContentResponse,
  CloudSecDocumentsResponse,
  CloudSecFilingsResponse,
  CloudOptionsChainPayload,
  CloudPricePointPayload,
  CloudQuotePayload,
  CloudTweetSearchResponse,
  CloudWorldVenueMapPayload,
  CloudYieldPointPayload,
} from "./types";

type CloudApiRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

export class CloudDataApi {
  constructor(private readonly request: CloudApiRequest) {}

  private requestMarketSymbol<T>(path: string, symbol: string, exchange?: string): Promise<CloudMarketResponse<T>> {
    return this.request<CloudMarketResponse<T>>(cloudMarketSymbolPath(path, symbol, exchange));
  }

  private postMarketBatch<T>(
    path: string,
    targets: CloudMarketBatchTarget[],
    mode: "cache-first" | "refresh",
  ): Promise<CloudMarketResponse<CloudMarketBatchPayload<T>>> {
    return this.request<CloudMarketResponse<CloudMarketBatchPayload<T>>>(path, {
      method: "POST",
      body: JSON.stringify({ targets, mode }),
    });
  }

  async searchInstruments(query: string, limit = 10): Promise<InstrumentSearchResult[]> {
    const response = await this.request<CloudMarketResponse<InstrumentSearchResult[]>>(cloudMarketSearchPath(query, limit));
    return response.data ?? [];
  }

  async getCloudQuote(symbol: string, exchange?: string): Promise<CloudMarketResponse<CloudQuotePayload>> {
    return this.requestMarketSymbol("/market/quote", symbol, exchange);
  }

  async getCloudQuotesBatch(
    targets: CloudMarketBatchTarget[],
    mode: "cache-first" | "refresh" = "cache-first",
  ): Promise<CloudMarketResponse<CloudMarketBatchPayload<CloudQuotePayload>>> {
    return this.postMarketBatch("/market/quotes/batch", targets, mode);
  }

  async getCloudWorldVenues(): Promise<CloudMarketResponse<CloudWorldVenueMapPayload>> {
    return this.request<CloudMarketResponse<CloudWorldVenueMapPayload>>("/market/venues");
  }

  async getCloudMarketScreener(
    category: CloudMarketScreenerCategory,
    count = 25,
    mode: "cache-first" | "refresh" = "cache-first",
  ): Promise<CloudMarketResponse<CloudMarketScreenerPayload>> {
    const requestedCount = Number.isFinite(count) ? Math.round(count) : 25;
    const params = new URLSearchParams({
      category,
      count: String(Math.max(1, Math.min(50, requestedCount))),
      mode,
    });
    return this.request<CloudMarketResponse<CloudMarketScreenerPayload>>(
      `/market/screener?${params.toString()}`,
    );
  }

  async getCloudOptionsChain(
    symbol: string,
    exchange?: string,
    expirationDate?: number,
  ): Promise<CloudMarketResponse<CloudOptionsChainPayload>> {
    return this.request<CloudMarketResponse<CloudOptionsChainPayload>>(cloudOptionsChainPath(symbol, exchange, expirationDate));
  }

  async getCloudProfile(symbol: string, exchange?: string): Promise<CloudMarketResponse<CloudCompanyProfile>> {
    return this.requestMarketSymbol("/market/profile", symbol, exchange);
  }

  async getCloudFundamentals(symbol: string, exchange?: string): Promise<CloudMarketResponse<CloudFundamentals>> {
    return this.requestMarketSymbol("/market/fundamentals", symbol, exchange);
  }

  async getCloudFinancials(symbol: string, exchange?: string): Promise<CloudMarketResponse<CloudFinancialsPayload>> {
    return this.requestMarketSymbol("/market/financials", symbol, exchange);
  }

  async getCloudFinancialsBatch(
    targets: CloudMarketBatchTarget[],
    mode: "cache-first" | "refresh" = "cache-first",
  ): Promise<CloudMarketResponse<CloudMarketBatchPayload<CloudFinancialsPayload>>> {
    return this.postMarketBatch("/market/financials/batch", targets, mode);
  }

  async getCloudHolders(symbol: string, exchange?: string): Promise<CloudMarketResponse<CloudHoldersPayload>> {
    return this.requestMarketSymbol("/market/holders", symbol, exchange);
  }

  async getCloudAnalystResearch(symbol: string, exchange?: string): Promise<CloudMarketResponse<CloudAnalystResearchPayload>> {
    return this.requestMarketSymbol("/market/analyst", symbol, exchange);
  }

  async getCloudShortInterest(symbol: string, years?: number): Promise<CloudMarketResponse<CloudShortInterestPayload>> {
    const params = new URLSearchParams({ symbol: symbol.toUpperCase() });
    if (years != null) params.set("years", String(years));
    return this.request<CloudMarketResponse<CloudShortInterestPayload>>(`/market/short-interest?${params}`);
  }

  async getCloudCorporateActions(symbol: string, exchange?: string): Promise<CloudMarketResponse<CloudCorporateActionsPayload>> {
    return this.requestMarketSymbol("/market/corporate-actions", symbol, exchange);
  }

  async getCloudStatements(
    symbol: string,
    exchange?: string,
    period: "annual" | "quarterly" | "both" = "both",
  ): Promise<CloudMarketResponse<Pick<TickerFinancials, "annualStatements" | "quarterlyStatements">>> {
    return this.request<CloudMarketResponse<Pick<TickerFinancials, "annualStatements" | "quarterlyStatements">>>(
      cloudStatementsPath(symbol, exchange, period),
    );
  }

  async getCloudHistory(
    symbol: string,
    exchange: string,
    params: CloudHistoryParams = {},
  ): Promise<CloudMarketResponse<CloudPricePointPayload[]>> {
    return this.request<CloudMarketResponse<CloudPricePointPayload[]>>(cloudHistoryPath(symbol, exchange, params));
  }

  async getCloudExchangeRate(fromCurrency: string): Promise<CloudMarketResponse<{ rate: number }>> {
    return this.request<CloudMarketResponse<{ rate: number }>>(cloudExchangeRatePath(fromCurrency));
  }

  /**
   * On-demand single-company evidence review. This is a cloud product endpoint,
   * not a market-data capability, so it is called directly instead of routed
   * through the asset-data provider.
   */
  async getCloudEquityDiagnostic(
    symbol: string,
    exchange?: string,
    mode: CloudEquityDiagnosticMode = "cache-first",
  ): Promise<CloudEquityDiagnosticResult> {
    return this.request<CloudEquityDiagnosticResult>("/research/equity-diagnostic", {
      method: "POST",
      body: JSON.stringify({
        symbol: symbol.trim().toUpperCase(),
        ...(exchange ? { exchange } : {}),
        mode,
      }),
    });
  }

  async getCloudEconomicCalendar(): Promise<CloudEconEventPayload[]> {
    return this.request<CloudEconEventPayload[]>("/cloud/econ/calendar");
  }

  async getCloudFredSeries(
    seriesId: string,
    params: CloudFredSeriesParams = {},
  ): Promise<CloudFredSeriesPayload> {
    return this.request<CloudFredSeriesPayload>(cloudFredSeriesPath(seriesId, params));
  }

  async getCloudShiller(): Promise<CloudShillerPayload> {
    return this.request<CloudShillerPayload>(cloudShillerPath());
  }

  async getCloudYieldCurve(): Promise<CloudYieldPointPayload[]> {
    return this.request<CloudYieldPointPayload[]>("/cloud/econ/yield-curve");
  }

  async getCloudCds(params: CloudCdsParams = {}): Promise<CloudCdsResponse> {
    return this.request<CloudCdsResponse>(cloudCdsPath(params));
  }

  async getCloudCongressHouse(params: CloudCongressHouseParams = {}): Promise<CloudCongressHousePayload> {
    return this.request<CloudCongressHousePayload>(cloudCongressHousePath(params));
  }

  async getCloudEarningsCalls(
    params: CloudEarningsCallsParams = {},
  ): Promise<CloudEarningsCallListPayload> {
    return this.request<CloudEarningsCallListPayload>(cloudEarningsCallsPath(params));
  }

  async getCloudEarningsTranscript(id: string): Promise<CloudEarningsTranscriptPayload> {
    return this.request<CloudEarningsTranscriptPayload>(cloudEarningsTranscriptPath(id));
  }

  async getProxyStatements(ticker: string): Promise<CloudProxyStatementListPayload> {
    return this.request<CloudProxyStatementListPayload>(publicProxyStatementsPath(ticker));
  }

  async getProxyStatement(ticker: string, year: number): Promise<CloudProxyStatementPayload> {
    return this.request<CloudProxyStatementPayload>(publicProxyStatementPath(ticker, year));
  }

  async getCloudSecFilings(params: CloudSecFilingsParams): Promise<CloudSecFilingsResponse> {
    return this.request<CloudSecFilingsResponse>(cloudSecFilingsPath(params));
  }

  async getCloudSecFilingDocuments(params: CloudSecFilingParams): Promise<CloudSecDocumentsResponse> {
    return this.request<CloudSecDocumentsResponse>(cloudSecFilingDocumentsPath(params));
  }

  async getCloudSecFilingContent(params: CloudSecFilingParams): Promise<CloudSecContentResponse> {
    return this.request<CloudSecContentResponse>(cloudSecFilingContentPath(params));
  }

  async getCloudSec13F(path: string, params: Record<string, string | number | undefined> = {}): Promise<unknown> {
    return this.request<unknown>(cloudSec13FPath(path, params));
  }

  /**
   * Cross-document full-text search. Pro-gated: unentitled accounts get a 402,
   * which the caller turns into the access gate rather than an empty result.
   */
  async searchCloudDocuments(
    params: CloudSearchParams,
    options?: { signal?: AbortSignal },
  ): Promise<CloudSearchResponse> {
    return normalizeSearchResponse(
      await this.request<CloudSearchResponse>(cloudSearchPath(params), { signal: options?.signal }),
    );
  }

  async getCloudSearchDocument(
    docType: CloudSearchDocType,
    sourceId: string,
    options?: { signal?: AbortSignal },
  ): Promise<CloudSearchDocument> {
    const response = await this.request<CloudSearchDocumentResponse>(
      cloudSearchDocumentPath(docType, sourceId),
      { signal: options?.signal },
    );
    return response.document;
  }

  async getCloudSavedSearches(options?: { signal?: AbortSignal }): Promise<CloudSavedSearch[]> {
    const response = await this.request<CloudSavedSearchListResponse>(cloudSavedSearchesPath(), {
      signal: options?.signal,
    });
    return response.searches ?? [];
  }

  async createCloudSavedSearch(input: CloudSavedSearchInput): Promise<CloudSavedSearch> {
    return normalizeSavedSearchResponse(await this.request<unknown>(cloudSavedSearchesPath(), {
      method: "POST",
      body: JSON.stringify(input),
    }));
  }

  async updateCloudSavedSearch(
    id: string,
    update: Partial<CloudSavedSearchInput>,
  ): Promise<CloudSavedSearch> {
    return normalizeSavedSearchResponse(await this.request<unknown>(cloudSavedSearchPath(id), {
      method: "PATCH",
      body: JSON.stringify(update),
    }));
  }

  async deleteCloudSavedSearch(id: string): Promise<void> {
    await this.request<void>(cloudSavedSearchPath(id), { method: "DELETE" });
  }

  async getCloudSavedSearchHits(
    id: string,
    options?: { signal?: AbortSignal },
  ): Promise<CloudSearchHit[]> {
    return normalizeSavedSearchHits(await this.request<unknown>(cloudSavedSearchHitsPath(id), {
      signal: options?.signal,
    }));
  }

  async getCloudNews(params: CloudNewsParams = {}): Promise<CloudNewsListResponse> {
    return this.request<CloudNewsListResponse>(cloudNewsPath(params));
  }

  async getCloudNewsStory(storyId: string): Promise<CloudNewsPayload> {
    return this.request<CloudNewsPayload>(`/news/${encodeURIComponent(storyId)}`);
  }

  async getCloudTickerTweets(params: CloudTickerTweetsParams): Promise<CloudTweetSearchResponse> {
    const response = await this.request<CloudTweetSearchResponse>(cloudTickerTweetsPath(params));
    return normalizeTweetSearchResponse(response);
  }

  async searchCloudTweets(params: CloudTweetSearchParams): Promise<CloudTweetSearchResponse> {
    const response = await this.request<CloudTweetSearchResponse>(cloudTweetSearchPath(params));
    return normalizeTweetSearchResponse(response);
  }


  async getCloudEstimateRevisions(symbol: string, exchange: string): Promise<EstimateRevisionsPayload> {
    return this.request<EstimateRevisionsPayload>(`/cloud/research/estimates/${encodeURIComponent(symbol)}?exchange=${encodeURIComponent(exchange)}`, { signal: AbortSignal.timeout(45_000) });
  }

  async getCloudEarningsCalendar(query: EarningsCalendarQuery): Promise<EarningsCalendarPayload> {
    const params = new URLSearchParams({ from: query.from, to: query.to });
    if (query.perDay != null) params.set("perDay", String(query.perDay));
    if (query.symbols?.length) params.set("symbols", query.symbols.join(","));
    return this.request<EarningsCalendarPayload>(`/cloud/earnings/calendar?${params}`, { signal: AbortSignal.timeout(30_000) });
  }

  async getCloudEarningsHistory(symbol: string): Promise<EarningsHistoryPayload> {
    const params = new URLSearchParams({ symbol, limit: "13" });
    return this.request<EarningsHistoryPayload>(`/cloud/earnings/history?${params}`, { signal: AbortSignal.timeout(30_000) });
  }

  async getCloudCotBoard(report: CotFamily, traderClass: CotClass): Promise<CotBoardPayload> {
    return this.request<CotBoardPayload>(`/cloud/cot/board?${new URLSearchParams({ report, traderClass })}`);
  }

  async getCloudCotContract(code: string, report: CotFamily): Promise<CotContractPayload> {
    return this.request<CotContractPayload>(`/cloud/cot/contracts/${encodeURIComponent(code)}?${new URLSearchParams({ report })}`);
  }

  /** Credit-document paths stay with their pane; keep the shared client small. */
  creditDocuments<T>(path: string): Promise<T> {
    return this.request<T>(`/cloud/credit-documents/${path}`);
  }

  async getCloudHiring(symbol?: string, query: { limit?: number; offset?: number } = {}, signal?: AbortSignal): Promise<HiringBoard | HiringPayload> {
    const params = new URLSearchParams({ limit: String(query.limit ?? 100), offset: String(query.offset ?? 0) });
    return this.request<HiringBoard | HiringPayload>(symbol ? `/cloud/hiring/${encodeURIComponent(symbol)}` : `/cloud/hiring?${params}`, { signal });
  }

  async getCloudAppRankHistory(store: "app-store" | "google-play", appId: string, query: AppAttentionFilter = {}, signal?: AbortSignal): Promise<AppRankPayload> {
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
    return this.request<AppRankPayload>(`/cloud/app-attention/app/${store}/${encodeURIComponent(appId)}?${params}`, { signal });
  }

  async getCloudAppAttention(query: AppAttentionFilter = {}, signal?: AbortSignal): Promise<AppAttentionPayload> {
    const { symbol, ...filters } = query;
    const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
    return this.request<AppAttentionPayload>(`/cloud/app-attention/${symbol ? encodeURIComponent(symbol) : "board"}?${params}`, { signal });
  }

  async getCloudCatalysts(query: CatalystFilters = {}, signal?: AbortSignal): Promise<CatalystResponse> {
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
    const route = query.litigation && query.symbol ? `/cloud/catalysts/litigation/${encodeURIComponent(query.symbol)}` : "/cloud/catalysts";
    return this.request<CatalystResponse>(`${route}?${params}`, { signal });
  }

  async getCloudCatalystChanges(query: { since: string; cursor?: string; limit?: number }, signal?: AbortSignal): Promise<CatalystChanges> {
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
    return this.request<CatalystChanges>(`/cloud/catalysts/changes?${params}`, { signal });
  }

  async getCloudCatalystEvent(id: string, signal?: AbortSignal, query: { offset?: number; limit?: number } = {}): Promise<CatalystDetail> {
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
    return this.request<CatalystDetail>(`/cloud/catalysts/events/${encodeURIComponent(id)}?${params}`, { signal });
  }

  async getCloudCatalystStatus(): Promise<CatalystStatus> {
    return this.request<CatalystStatus>("/cloud/catalysts/status");
  }

  async getCloudCompanyKpis(symbol: string, options: KpiQueryOptions = {}): Promise<KpisPayload> {
    return this.request<KpisPayload>(companyDisclosurePath("kpis", symbol, options));
  }

  async getCloudCompanyGuidance(symbol: string, options: KpiQueryOptions = {}): Promise<GuidancePayload> {
    return this.request<GuidancePayload>(companyDisclosurePath("guidance", symbol, options));
  }
  async getCloudPerpsBoard(query: PerpBoardQuery = {}): Promise<PerpBoardPayload> {
    return this.request(`/cloud/perps/board?${new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]))}`);
  }
  async getCloudPerpsHistory(query: PerpHistoryQuery): Promise<PerpHistoryPayload> {
    return this.request(`/cloud/perps/history?${new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]))}`);
  }
  async getCloudPerpsRankings(): Promise<PerpRankingsPayload> { return this.request("/cloud/perps/rankings"); }
  async getCloudPerpsCompare(baseAsset: string): Promise<PerpBoardPayload> { return this.request(`/cloud/perps/compare?${new URLSearchParams({ baseAsset })}`); }
  async getCloudPerpsEquity(symbol: string): Promise<PerpBoardPayload> { return this.request(`/cloud/perps/equity/${encodeURIComponent(symbol)}`); }
  async getCloudPerpsMarket(marketId: string): Promise<PerpMarketPayload> { return this.request(`/cloud/perps/market?${new URLSearchParams({ marketId })}`); }

  async analyzeCloudExposure(request: ExposureRequest): Promise<ExposurePayload> {
    return this.request<ExposurePayload>("/cloud/exposure/analyze", { method: "POST", body: JSON.stringify(request) });
  }

  async getCloudExposureScenarios(): Promise<{ scenarios: ExposureScenario[] }> {
    return this.request<{ scenarios: ExposureScenario[] }>("/cloud/exposure/scenarios");
  }

  async getCloudSupplyChain(symbol: string, options: SupplyOptions = {}): Promise<SupplyChainPayload> {
    const query = new URLSearchParams();
    if (options.tiers?.length) query.set("tiers", options.tiers.join(","));
    if (options.includeLeads) query.set("includeLeads", "1");
    return this.request<SupplyChainPayload>(`/cloud/supply-chain/${encodeURIComponent(symbol)}${query.size ? `?${query}` : ""}`);
  }

  getCloudAwards(query: AwardFilter = {}, signal?: AbortSignal): Promise<AwardsPayload> {
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value != null).map(([key, value]) => [key, `${value}`]));
    return this.request<AwardsPayload>(`/cloud/awards?${params}`, { signal });
  }

  getCloudAward(id: string, signal?: AbortSignal, revisionsCursor?: string): Promise<AwardDetailPayload> {
    const query = revisionsCursor ? `?${new URLSearchParams({ revisionsCursor })}` : "";
    return this.request<AwardDetailPayload>(`/cloud/awards/detail/${encodeURIComponent(id)}${query}`, { signal });
  }

  async getCloudSupplyGraph(symbol: string, options: Partial<GraphOptions> = {}): Promise<GraphPayload> {
    return this.request<GraphPayload>(`/cloud/supply-chain/${encodeURIComponent(symbol)}/graph?${supplyGraphQuery(options)}`);
  }

  async getCloudSupplyPaths(from: string, to: string, options: Partial<GraphOptions> = {}): Promise<GraphPayload> {
    return this.request<GraphPayload>(`/cloud/supply-chain/paths?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&${supplyGraphQuery(options)}`);
  }

  async getCloudDoeBoard(): Promise<DoeBoardPayload> {
    return this.request<DoeBoardPayload>("/cloud/doe/board");
  }

  async getCloudAttention(window: AttentionWindow = "now", symbol?: string): Promise<AttentionPayload> {
    const path = symbol ? `/cloud/attention/${encodeURIComponent(symbol)}` : "/cloud/attention";
    return this.request<AttentionPayload>(`${path}?window=${window}`);
  }

  async getCloudPowerBoard(query: PowerFilter = {}, signal?: AbortSignal): Promise<PowerBoard> {
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
    return this.request<PowerBoard>(`/cloud/power/board?${params}`, { signal });
  }

  async getCloudPowerHistory(query: PowerFilter = {}): Promise<PowerHistory> {
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
    return this.request<PowerHistory>(`/cloud/power/history?${params}`);
  }

  async getCloudPowerProject(id: string, query: Pick<PowerFilter, "offset" | "limit"> = {}, signal?: AbortSignal): Promise<PowerDetail> {
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
    return this.request<PowerDetail>(`/cloud/power/projects/${encodeURIComponent(id)}?${params}`, { signal });
  }

  async getCloudGpuBoard(): Promise<GpuBoardPayload> {
    return this.request<GpuBoardPayload>("/cloud/gpu/board");
  }

  async getCloudGpuHistory(query: GpuHistoryQuery = {}): Promise<GpuHistoryPayload> {
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
    return this.request<GpuHistoryPayload>(`/cloud/gpu/history?${params}`);
  }

  async getCloudGpuEvents(gpuModel?: string): Promise<GpuEventsPayload> {
    const params = new URLSearchParams({ limit: "1000", ...(gpuModel ? { gpuModel } : {}) });
    return this.request<GpuEventsPayload>(`/cloud/gpu/events?${params}`);
  }

  async getCloudCpiBoard(): Promise<CpiBoardPayload> {
    return this.request<CpiBoardPayload>("/cloud/cpi/board");
  }

  async getCloudTape(symbol: string, exchange: string, signal?: AbortSignal): Promise<TapeSnapshot> {
    return this.request<TapeSnapshot>(`/cloud/tape/${encodeURIComponent(symbol)}?exchange=${encodeURIComponent(exchange)}`, { signal: signal ?? AbortSignal.timeout(30_000) });
  }

  async getCloudCryptoMarkets(): Promise<CryptoMarketsPayload> {
    return this.request<CryptoMarketsPayload>("/cloud/crypto/markets", { signal: AbortSignal.timeout(45_000) });
  }

  async getCloudCentralBankRates(): Promise<CentralBankRatesPayload> {
    return this.request<CentralBankRatesPayload>("/cloud/econ/central-bank-rates", { signal: AbortSignal.timeout(45_000) });
  }

  async getCloudMoneyMarkets(): Promise<MoneyMarketsPayload> {
    return this.request<MoneyMarketsPayload>("/cloud/econ/money-markets", { signal: AbortSignal.timeout(45_000) });
  }

  async getCloudDebtMaturities(symbol: string): Promise<DebtMaturitiesPayload> {
    const params = new URLSearchParams({ symbol });
    return this.request<DebtMaturitiesPayload>(`/cloud/debt-maturities?${params}`, { signal: AbortSignal.timeout(45_000) });
  }

  async getCloudRevenueBreakdown(symbol: string, view?: RevenueBreakdownView): Promise<RevenueBreakdownPayload> {
    const params = new URLSearchParams({ symbol, ...(view ? { view } : {}) });
    return this.request<RevenueBreakdownPayload>(`/cloud/revenue-breakdown?${params}`, { signal: AbortSignal.timeout(30_000) });
  }

  async getCloudShortVolume(symbol: string, scope: ShortVolumeScope = "nms"): Promise<ShortVolumePayload> {
    const params = new URLSearchParams({ symbol, scope });
    return this.request<ShortVolumePayload>(`/cloud/short-volume?${params}`, { signal: AbortSignal.timeout(20_000) });
  }

  async getCloudRatePath(): Promise<RatePathPayload> {
    return this.request<RatePathPayload>("/cloud/econ/rate-path", { signal: AbortSignal.timeout(45_000) });
  }

  async getCloudCdsHistory(params: CloudCdsHistoryParams): Promise<CloudCdsHistoryResponse> {
    return this.request<CloudCdsHistoryResponse>(cloudCdsHistoryPath(params), { signal: AbortSignal.timeout(30_000) });
  }

  async getCloudCdxBoard(params: CloudCreditBoardParams = {}): Promise<CdxBoardPayload> {
    return this.request<CdxBoardPayload>(cloudCreditBoardPath("cdx", params), { signal: AbortSignal.timeout(30_000) });
  }

  async getCloudSovrBoard(params: CloudCreditBoardParams = {}): Promise<SovrBoardPayload> {
    return this.request<SovrBoardPayload>(cloudCreditBoardPath("sovr", params), { signal: AbortSignal.timeout(30_000) });
  }

  async getCloudJobs(ticker: string, name?: string | null): Promise<CloudJobsResponse> {
    return this.request<CloudJobsResponse>(cloudJobsPath(ticker, name));
  }

  async getCloudJobsPostings(
    ticker: string,
    params: CloudJobsPostingsParams = {},
  ): Promise<CloudJobsPostingsPayload> {
    return this.request<CloudJobsPostingsPayload>(cloudJobsPostingsPath(ticker, params));
  }

  async getCloudJobsMovers(limit?: number, offset?: number): Promise<CloudJobsMoversPayload> {
    return this.request<CloudJobsMoversPayload>(cloudJobsMoversPath(limit, offset));
  }
}

