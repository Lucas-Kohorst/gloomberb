import type {
  CompanyProfile,
  Fundamentals,
  PricePoint,
  Quote,
  TickerFinancials,
} from "../../types/financials";
import {
  buildYahooStatements,
  computeYahooReturn,
  latestYahooMetric,
  parseYahooTimeseries,
  YAHOO_TIMESERIES_TYPES,
} from "./financials";
import {
  deriveMarketState,
  financeRawNumber,
  normalizeMarketValue,
  normalizePositiveMarketValue,
  normalizeSubUnitCurrency,
  normalizeYahooMarketState,
  type ExtendedHoursData,
} from "./mappers";
import type { ChartResult, YahooQuoteApiResult } from "./types";

type YahooChartSnapshot = {
  meta: NonNullable<ChartResult["meta"]>;
  history: PricePoint[];
};

type YahooQuoteSupplement = Pick<
  Quote,
  | "bid"
  | "ask"
  | "bidSize"
  | "askSize"
  | "previousClose"
  | "open"
  | "high"
  | "low"
>;

interface YahooSnapshotLoaders {
  fetchAssetProfile: (symbol: string) => Promise<CompanyProfile | undefined>;
  fetchChart: (symbol: string, range: string, interval?: string) => Promise<YahooChartSnapshot>;
  fetchExtendedHoursData: (
    symbol: string,
    meta: NonNullable<ChartResult["meta"]>,
    regularClose?: number,
  ) => Promise<ExtendedHoursData>;
  fetchQuoteSupplement: (
    symbol: string,
    currencyDivisor?: number,
  ) => Promise<YahooQuoteSupplement>;
  fetchTimeseries: (
    symbol: string,
    types: string[],
    period1?: string,
  ) => Promise<Array<Record<string, any>>>;
  providerId: string;
}

export interface YahooQuoteLoaders {
  fetchQuotes: (symbols: string[]) => Promise<YahooQuoteApiResult[]>;
  fetchExtendedHoursData: (
    symbol: string,
    meta: NonNullable<ChartResult["meta"]>,
    regularClose?: number,
  ) => Promise<ExtendedHoursData>;
  providerId: string;
}

function normalizePriceHistory(history: PricePoint[], currencyDivisor: number): void {
  for (const point of history) {
    point.close /= currencyDivisor;
    if (point.open != null) point.open /= currencyDivisor;
    if (point.high != null) point.high /= currencyDivisor;
    if (point.low != null) point.low /= currencyDivisor;
  }
}

function normalizeChartMetaPrices(
  meta: NonNullable<ChartResult["meta"]>,
  currencyDivisor: number,
): void {
  if (meta.regularMarketPrice != null) meta.regularMarketPrice /= currencyDivisor;
  if (meta.chartPreviousClose != null) meta.chartPreviousClose /= currencyDivisor;
  if (meta.fiftyTwoWeekHigh != null) meta.fiftyTwoWeekHigh /= currencyDivisor;
  if (meta.fiftyTwoWeekLow != null) meta.fiftyTwoWeekLow /= currencyDivisor;
}

function normalizeExtendedHoursPrices(
  extHours: ExtendedHoursData,
  currencyDivisor: number,
): void {
  if (extHours.preMarketPrice != null) extHours.preMarketPrice /= currencyDivisor;
  if (extHours.preMarketChange != null) extHours.preMarketChange /= currencyDivisor;
  if (extHours.postMarketPrice != null) extHours.postMarketPrice /= currencyDivisor;
  if (extHours.postMarketChange != null) extHours.postMarketChange /= currencyDivisor;
}

function normalizeChartCurrency(
  chart: YahooChartSnapshot,
): { normalizedCurrency: string; currencyDivisor: number } {
  const rawCurrency = chart.meta.currency || "USD";
  const { currency: normalizedCurrency, divisor: currencyDivisor } =
    normalizeSubUnitCurrency(rawCurrency);

  if (currencyDivisor !== 1) {
    normalizePriceHistory(chart.history, currencyDivisor);
    normalizeChartMetaPrices(chart.meta, currencyDivisor);
  }

  return { normalizedCurrency, currencyDivisor };
}

export async function loadYahooTickerFinancials(
  symbol: string,
  loaders: YahooSnapshotLoaders,
): Promise<TickerFinancials> {
  const [chart, tsRaw, profile] = await Promise.all([
    loaders.fetchChart(symbol, "5y", "1wk"),
    loaders.fetchTimeseries(symbol, [
      ...YAHOO_TIMESERIES_TYPES.annual,
      ...YAHOO_TIMESERIES_TYPES.quarterly,
      ...YAHOO_TIMESERIES_TYPES.trailing,
    ]),
    loaders.fetchAssetProfile(symbol).catch(() => undefined),
  ]);

  const { meta, history } = chart;
  if (!history.length) throw new Error(`No history for ${symbol}`);

  const metrics = parseYahooTimeseries(tsRaw);
  const latest = (type: string) => latestYahooMetric(metrics, type);
  const { normalizedCurrency, currencyDivisor } = normalizeChartCurrency(chart);
  const quoteSupplement = await loaders.fetchQuoteSupplement(symbol, currencyDivisor);

  const currentPrice = meta.regularMarketPrice ?? history[history.length - 1]!.close;
  const prev = history.length > 1 ? history[history.length - 2]!.close : meta.chartPreviousClose;
  const change = prev != null ? currentPrice - prev : 0;
  const changePct = prev ? (change / prev) * 100 : 0;

  const marketState = deriveMarketState(meta);
  const extendedHoursBase = quoteSupplement.previousClose ?? prev;
  const extHours = await loaders.fetchExtendedHoursData(
    symbol,
    meta,
    extendedHoursBase == null ? undefined : extendedHoursBase * currencyDivisor,
  );
  if (currencyDivisor !== 1) {
    normalizeExtendedHoursPrices(extHours, currencyDivisor);
  }

  const quote: Quote = {
    symbol,
    providerId: loaders.providerId,
    price: currentPrice,
    currency: normalizedCurrency,
    change,
    changePercent: changePct,
    high52w: meta.fiftyTwoWeekHigh,
    low52w: meta.fiftyTwoWeekLow,
    marketCap: latest("trailingMarketCap"),
    name: meta.shortName || meta.longName,
    lastUpdated: yahooMarketTimestamp(meta),
    exchangeName: meta.exchangeName,
    fullExchangeName: meta.fullExchangeName,
    listingExchangeName: meta.exchangeName,
    listingExchangeFullName: meta.fullExchangeName,
    marketState,
    sessionConfidence: "derived",
    dataSource: "delayed",
    ...quoteSupplement,
    ...extHours,
  };

  const revenue = latest("annualTotalRevenue");
  const netIncome = latest("annualNetIncome");

  const fundamentals: Fundamentals = {
    trailingPE: latest("trailingPeRatio"),
    forwardPE: latest("trailingForwardPeRatio"),
    pegRatio: latest("trailingPegRatio"),
    enterpriseValue: latest("trailingEnterpriseValue"),
    operatingCashFlow: latest("trailingOperatingCashFlow"),
    freeCashFlow: latest("trailingFreeCashFlow"),
    dividendYield: latest("trailingDividendYield"),
    revenue,
    netIncome,
    eps: latest("annualDilutedEPS"),
    operatingMargin: revenue && latest("annualEBITDA") != null
      ? latest("annualEBITDA")! / revenue
      : undefined,
    profitMargin: revenue && netIncome != null ? netIncome / revenue : undefined,
    return1Y: computeYahooReturn(history, 365),
    return3Y: computeYahooReturn(history, 3 * 365),
    sharesOutstanding: latest("annualDilutedAverageShares"),
  };

  return {
    quote,
    fundamentals,
    profile,
    annualStatements: buildYahooStatements(metrics, "annual"),
    quarterlyStatements: buildYahooStatements(metrics, "quarterly"),
    priceHistory: history,
  };
}

export async function loadYahooQuotes(
  symbols: string[],
  loaders: YahooQuoteLoaders,
): Promise<Map<string, Quote>> {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const symbol of symbols) {
    const key = symbol.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(symbol);
  }

  const rawList = await loaders.fetchQuotes(unique);
  const rawBySymbol = new Map<string, YahooQuoteApiResult>();
  for (const raw of rawList) {
    if (!raw.symbol) continue;
    rawBySymbol.set(raw.symbol.toUpperCase(), raw);
  }

  const quotes = new Map<string, Quote>();
  await Promise.all(unique.map(async (symbol) => {
    const raw = rawBySymbol.get(symbol.toUpperCase());
    if (!raw) return;
    quotes.set(symbol.toUpperCase(), await assembleYahooQuote(symbol, raw, loaders));
  }));
  return quotes;
}

export async function loadYahooQuote(
  symbol: string,
  loaders: YahooQuoteLoaders,
): Promise<Quote> {
  const quotes = await loadYahooQuotes([symbol], loaders);
  const quote = quotes.get(symbol.toUpperCase());
  if (!quote) throw new Error(`No quote for ${symbol}`);
  return quote;
}

async function assembleYahooQuote(
  symbol: string,
  raw: YahooQuoteApiResult,
  loaders: YahooQuoteLoaders,
): Promise<Quote> {
  const { currency: normalizedCurrency, divisor } = normalizeSubUnitCurrency(raw.currency || "USD");
  const price = normalizePositiveMarketValue(financeRawNumber(raw.regularMarketPrice), divisor);
  if (price == null) throw new Error(`No quote for ${symbol}`);

  const previousClose = normalizeMarketValue(financeRawNumber(raw.regularMarketPreviousClose), divisor);
  const changeRaw = financeRawNumber(raw.regularMarketChange);
  const change = changeRaw != null
    ? changeRaw / divisor
    : previousClose != null ? price - previousClose : 0;
  const changePercent = financeRawNumber(raw.regularMarketChangePercent)
    ?? (previousClose ? (change / previousClose) * 100 : 0);

  const explicitState = normalizeYahooMarketState(raw.marketState);
  const marketState = explicitState ?? "CLOSED";
  let extHours = compactExtendedHours(mapYahooQuoteExtendedHours(raw, divisor));
  const needsExtendedHours =
    (marketState === "PRE" && extHours.preMarketPrice == null)
    || (marketState === "POST" && extHours.postMarketPrice == null);

  if (needsExtendedHours) {
    const regularCloseRaw = financeRawNumber(raw.regularMarketPreviousClose);
    const fetched = await loaders.fetchExtendedHoursData(
      symbol,
      {
        regularMarketPrice: financeRawNumber(raw.regularMarketPrice),
        chartPreviousClose: regularCloseRaw,
        marketState: explicitState,
      },
      regularCloseRaw,
    );
    if (divisor !== 1) normalizeExtendedHoursPrices(fetched, divisor);
    extHours = { ...fetched, ...extHours };
  }

  const exchangeName = raw.exchangeName || raw.exchange;
  const fullExchangeName = raw.fullExchangeName || exchangeName;

  return {
    symbol,
    providerId: loaders.providerId,
    price,
    currency: normalizedCurrency,
    change,
    changePercent,
    high52w: normalizeMarketValue(financeRawNumber(raw.fiftyTwoWeekHigh), divisor),
    low52w: normalizeMarketValue(financeRawNumber(raw.fiftyTwoWeekLow), divisor),
    name: raw.shortName || raw.longName,
    lastUpdated: yahooMarketTimestamp({ regularMarketTime: financeRawNumber(raw.regularMarketTime) }),
    exchangeName,
    fullExchangeName,
    listingExchangeName: exchangeName,
    listingExchangeFullName: fullExchangeName,
    marketState,
    sessionConfidence: explicitState ? "explicit" : "unknown",
    dataSource: "delayed",
    bid: normalizePositiveMarketValue(financeRawNumber(raw.bid), divisor),
    ask: normalizePositiveMarketValue(financeRawNumber(raw.ask), divisor),
    bidSize: financeRawNumber(raw.bidSize),
    askSize: financeRawNumber(raw.askSize),
    previousClose,
    open: normalizeMarketValue(financeRawNumber(raw.regularMarketOpen), divisor),
    high: normalizeMarketValue(financeRawNumber(raw.regularMarketDayHigh), divisor),
    low: normalizeMarketValue(financeRawNumber(raw.regularMarketDayLow), divisor),
    ...extHours,
  };
}

function mapYahooQuoteExtendedHours(
  raw: YahooQuoteApiResult,
  divisor: number,
): ExtendedHoursData {
  return {
    preMarketPrice: normalizeMarketValue(financeRawNumber(raw.preMarketPrice), divisor),
    preMarketChange: normalizeMarketValue(financeRawNumber(raw.preMarketChange), divisor),
    preMarketChangePercent: financeRawNumber(raw.preMarketChangePercent),
    postMarketPrice: normalizeMarketValue(financeRawNumber(raw.postMarketPrice), divisor),
    postMarketChange: normalizeMarketValue(financeRawNumber(raw.postMarketChange), divisor),
    postMarketChangePercent: financeRawNumber(raw.postMarketChangePercent),
  };
}

function compactExtendedHours(data: ExtendedHoursData): ExtendedHoursData {
  const result: ExtendedHoursData = {};
  if (data.preMarketPrice != null) result.preMarketPrice = data.preMarketPrice;
  if (data.preMarketChange != null) result.preMarketChange = data.preMarketChange;
  if (data.preMarketChangePercent != null) result.preMarketChangePercent = data.preMarketChangePercent;
  if (data.postMarketPrice != null) result.postMarketPrice = data.postMarketPrice;
  if (data.postMarketChange != null) result.postMarketChange = data.postMarketChange;
  if (data.postMarketChangePercent != null) result.postMarketChangePercent = data.postMarketChangePercent;
  return result;
}

function yahooMarketTimestamp(meta: NonNullable<ChartResult["meta"]>): number {
  const marketTime = meta.regularMarketTime;
  if (typeof marketTime === "number" && Number.isFinite(marketTime) && marketTime > 0) {
    return marketTime < 1e12 ? marketTime * 1000 : marketTime;
  }
  return Date.now();
}
