import { getSharedRegistry } from "../../../registry";
import {
  AmbiguousContractError,
  AmbiguousTickerError,
  resolveTickerSearch,
  symbolSearchQuery,
  type ResolvedTickerSearch,
} from "../../../../tickers/search";
import type { Quote } from "../../../../types/financials";
import type { TickerRecord } from "../../../../types/ticker";
import { canonicalExchange, parsePublicTickerKey, publicTickerKey } from "../../../../utils/exchanges";

const QUICK_ADD_MAX_QUERY_LENGTH = 32;
const QUICK_ADD_SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-\s]*$/;
const QUICK_ADD_COLON_RE = /^([A-Z0-9][A-Z0-9.\-]{0,20}):([A-Z0-9.\-]*)$/;

export type QuickAddCollectionKind = "portfolio" | "watchlist";

interface ResolvedQuickAdd {
  query: string;
  symbol: string;
  resolved: ResolvedTickerSearch;
  ticker: TickerRecord | null;
  quote: Quote | null;
}

/** One venue offered when the add row is asked to choose (`NET:`). */
export interface QuickAddListingChoice {
  /** Public listing key, such as `NET:XNYS`. Submitting this adds that venue. */
  id: string;
  name: string;
  /** Canonical venue, such as `NYSE`, shown on the row. */
  exchange: string;
}

export type QuickAddValidation =
  | { status: "idle"; query: "" }
  | { status: "checking"; query: string }
  | (ResolvedQuickAdd & { status: "ready" })
  | (ResolvedQuickAdd & { status: "duplicate" })
  | { status: "choose"; query: string; symbol: string; listings: QuickAddListingChoice[] }
  | { status: "missing"; query: string; message: string }
  | { status: "error"; query: string; message: string };

export const IDLE_VALIDATION: QuickAddValidation = { status: "idle", query: "" };

export function normalizeQuickAddQuery(value: string): string {
  return value.replace(/^\s*\$/, "").trim().toUpperCase().replace(/\s+/g, " ");
}

function colonQuery(query: string): { symbol: string; suffix: string } | null {
  const match = QUICK_ADD_COLON_RE.exec(query);
  if (!match) return null;
  return { symbol: match[1] ?? "", suffix: match[2] ?? "" };
}

export function isPlausibleTickerQuery(query: string): boolean {
  return query.length > 0
    && query.length <= QUICK_ADD_MAX_QUERY_LENGTH
    && (QUICK_ADD_SYMBOL_RE.test(query) || colonQuery(query) !== null);
}

function tickerBelongsToCollection(
  ticker: TickerRecord | null,
  collectionKind: QuickAddCollectionKind,
  collectionId: string,
): boolean {
  if (!ticker) return false;
  return collectionKind === "portfolio"
    ? ticker.metadata.portfolios.includes(collectionId)
    : ticker.metadata.watchlists.includes(collectionId);
}

function quoteContextFromResolved(resolved: ResolvedTickerSearch) {
  const instrument = resolved.kind === "provider"
    ? resolved.result.brokerContract
    : resolved.ticker.metadata.broker_contracts?.[0];
  return instrument
    ? {
        brokerId: instrument.brokerId,
        brokerInstanceId: instrument.brokerInstanceId,
        instrument,
      }
    : undefined;
}

function exchangeFromResolved(resolved: ResolvedTickerSearch): string | undefined {
  return resolved.kind === "provider"
    ? resolved.result.exchange
    : resolved.ticker.metadata.exchange;
}

export function tickerNameFromValidation(
  validation: Extract<QuickAddValidation, { status: "ready" | "duplicate" }>,
): string {
  if (validation.resolved.kind === "provider" && !validation.ticker) return validation.resolved.result.name;
  if (validation.ticker?.metadata.name) return validation.ticker.metadata.name;
  return validation.resolved.kind === "provider" ? validation.resolved.result.name : "";
}

export function exchangeLabelFromValidation(
  validation: Extract<QuickAddValidation, { status: "ready" | "duplicate" }>,
): string {
  if (validation.resolved.kind === "provider") {
    const result = validation.resolved.result;
    return result.exchange === "SMART" ? result.primaryExchange || result.exchange : result.exchange || "";
  }
  return validation.ticker?.metadata.exchange || "";
}

function listingChoices(error: AmbiguousTickerError): QuickAddListingChoice[] {
  return error.listings.map((id) => {
    const parsed = parsePublicTickerKey(id);
    return {
      id,
      name: error.listingNames[id] ?? "",
      exchange: canonicalExchange(parsed.exchange) || parsed.exchange || "",
    };
  });
}

function listingCode(id: string): string {
  const normalized = id.trim().toUpperCase();
  const separator = normalized.lastIndexOf(":");
  if (separator <= 0 || separator === normalized.length - 1) return "";
  return normalized.slice(separator + 1);
}

function choiceMatchesSuffix(choice: QuickAddListingChoice, suffix: string): boolean {
  if (!suffix) return true;
  const exchange = choice.exchange.toUpperCase();
  if (exchange.startsWith(suffix) || listingCode(choice.id).startsWith(suffix)) return true;
  const aliased = canonicalExchange(suffix);
  return aliased === exchange && aliased !== suffix;
}

/**
 * The symbol key can already store a different company. Only that company's
 * own record, and its cached quote, belong to this add.
 */
function tickerForResolved(
  resolved: ResolvedTickerSearch,
  tickers: Map<string, TickerRecord>,
): TickerRecord | null {
  if (resolved.kind === "local") return resolved.ticker;
  const result = resolved.result;
  const exchange = canonicalExchange(result.exchange === "SMART" ? result.primaryExchange : result.exchange);
  const bare = parsePublicTickerKey(resolved.symbol).symbol;
  const qualified = publicTickerKey(bare, exchange || undefined);
  const qualifiedTicker = qualified === bare ? undefined : tickers.get(qualified);
  if (qualifiedTicker) return qualifiedTicker;
  const saved = tickers.get(bare) ?? tickers.get(resolved.symbol) ?? null;
  if (!saved) return null;
  const savedExchange = canonicalExchange(saved.metadata.exchange);
  if (exchange && savedExchange && exchange !== savedExchange) return null;
  return saved;
}

export async function resolveQuickAddValidation({
  query,
  collectionId,
  collectionKind,
  tickers,
  financials,
}: {
  query: string;
  collectionId: string;
  collectionKind: QuickAddCollectionKind;
  tickers: Map<string, TickerRecord>;
  financials: Map<string, { quote?: Quote | null }>;
}): Promise<QuickAddValidation> {
  if (!query) return IDLE_VALIDATION;
  if (!isPlausibleTickerQuery(query)) {
    return { status: "missing", query, message: "Use a ticker symbol" };
  }

  const registry = getSharedRegistry();
  if (!registry) {
    return { status: "error", query, message: "Ticker lookup unavailable" };
  }

  const describe = async (resolved: ResolvedTickerSearch): Promise<QuickAddValidation> => {
    const ticker = tickerForResolved(resolved, tickers);
    const cachedQuote = ticker ? financials.get(ticker.metadata.ticker)?.quote ?? null : null;
    let quote = cachedQuote;
    if (!quote) {
      try {
        const bare = resolved.kind === "local"
          ? resolved.symbol
          : parsePublicTickerKey(resolved.symbol).symbol;
        quote = await registry.marketData.getQuote(
          bare,
          exchangeFromResolved(resolved),
          quoteContextFromResolved(resolved),
        );
      } catch {
        quote = null;
      }
    }

    return {
      status: tickerBelongsToCollection(ticker, collectionKind, collectionId) ? "duplicate" : "ready",
      query,
      symbol: ticker?.metadata.ticker ?? resolved.symbol,
      resolved,
      ticker,
      quote,
    };
  };

  const chooseFrom = async (error: AmbiguousTickerError): Promise<QuickAddValidation> => {
    const suffix = colonQuery(query)?.suffix ?? "";
    const listings = listingChoices(error).filter((choice) => choiceMatchesSuffix(choice, suffix));
    if (listings.length === 0) {
      return { status: "missing", query, message: "No exact ticker match" };
    }
    if (listings.length === 1 && suffix) {
      try {
        const resolved = await resolveTickerSearch({
          query: listings[0]!.id,
          activeTicker: null,
          tickers,
          dataProvider: registry.marketData,
          preferHighestVolume: true,
        });
        if (resolved) return describe(resolved);
      } catch {
        return { status: "error", query, message: "Ticker lookup failed" };
      }
      return { status: "missing", query, message: "No exact ticker match" };
    }
    return {
      status: "choose",
      query,
      symbol: colonQuery(query)?.symbol || symbolSearchQuery(query),
      listings,
    };
  };

  const search = (tickerQuery: string) => resolveTickerSearch({
    query: tickerQuery,
    activeTicker: null,
    tickers,
    dataProvider: registry.marketData,
    preferHighestVolume: true,
  });

  const colon = colonQuery(query);
  try {
    const resolved = await search(query);
    if (resolved) return describe(resolved);
    if (!colon?.suffix) return { status: "missing", query, message: "No exact ticker match" };
  } catch (error) {
    if (error instanceof AmbiguousTickerError && !(error instanceof AmbiguousContractError)) {
      return chooseFrom(error);
    }
    return { status: "error", query, message: "Ticker lookup failed" };
  }

  // `NET:N` is not a listing key. Open the venue list for NET and keep the rows the prefix matches.
  try {
    const resolved = await search(`${colon!.symbol}:`);
    if (resolved) return describe(resolved);
    return { status: "missing", query, message: "No exact ticker match" };
  } catch (error) {
    if (error instanceof AmbiguousTickerError && !(error instanceof AmbiguousContractError)) {
      return chooseFrom(error);
    }
    return { status: "error", query, message: "Ticker lookup failed" };
  }
}
