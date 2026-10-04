import type { DataProvider, SearchRequestContext } from "../../types/data-provider";
import type { InstrumentSearchResult } from "../../types/instrument";
import type { BrokerCandidate } from "./brokers";
import { shouldLogProviderError } from "../provider-errors";

const SEARCH_CACHE_TTL_MS = 30_000;
const SEARCH_CACHE_MAX_ENTRIES = 100;

const SEARCH_PROVIDER_TIMEOUT_MS = 5_000;
/**
 * A keystroke path cannot wait the batch budget on a source that is failing
 * slowly. A broker whose gateway is down is the common case, and five seconds
 * of it is indistinguishable from the feature being broken.
 */
const INTERACTIVE_SEARCH_TIMEOUT_MS = 800;

interface BrokerSearchCandidate {
  brokerId: string;
  brokerInstanceId: string;
  brokerLabel: string;
}

function withSearchTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });
}

function buildSearchCacheKey(query: string, context?: SearchRequestContext): string {
  return JSON.stringify([
    query.trim().toUpperCase(),
    context?.preferBroker ?? true,
    context?.brokerInstanceId ?? "",
    context?.brokerId ?? "",
  ]);
}

function mergeSearchResults(
  results: InstrumentSearchResult[],
  resultIndexByKey: Map<string, number>,
  items: InstrumentSearchResult[],
  context?: SearchRequestContext,
): void {
  for (const item of items) {
    const key = buildSearchResultKey(item);
    const existingIndex = resultIndexByKey.get(key);
    if (existingIndex == null) {
      resultIndexByKey.set(key, results.length);
      results.push(item);
      continue;
    }

    const existing = results[existingIndex]!;
    const incomingRicher = getSearchResultRichness(item, context) > getSearchResultRichness(existing, context);
    const preferred = incomingRicher ? item : existing;
    const other = incomingRicher ? existing : item;
    const merged = mergeListingActivity(preferred, other);
    if (merged !== existing) results[existingIndex] = merged;
  }
}

function annotateBrokerSearchResults(
  items: InstrumentSearchResult[],
  candidate: BrokerSearchCandidate,
): InstrumentSearchResult[] {
  return items.map((item) => ({
    ...item,
    brokerInstanceId: item.brokerInstanceId ?? candidate.brokerInstanceId,
    brokerLabel: item.brokerLabel ?? candidate.brokerLabel,
    brokerContract: item.brokerContract
      ? {
        ...item.brokerContract,
        brokerId: item.brokerContract.brokerId || candidate.brokerId,
        brokerInstanceId: item.brokerContract.brokerInstanceId ?? candidate.brokerInstanceId,
      }
      : undefined,
  }));
}

export interface ProviderRouterSearchDeps {
  getBrokerCandidates(preferredBrokerInstanceId?: string, preferredBrokerId?: string): BrokerCandidate[];
  providersInPriorityOrder(): DataProvider[];
  logProviderError(message: string): void;
}

export class ProviderRouterSearchRoutes {
  private readonly searchCache = new Map<string, { expiresAt: number; results: InstrumentSearchResult[] }>();
  private readonly searchInFlight = new Map<string, Promise<InstrumentSearchResult[]>>();

  constructor(private readonly deps: ProviderRouterSearchDeps) {}

  async search(query: string, context?: SearchRequestContext): Promise<InstrumentSearchResult[]> {
    const cacheKey = buildSearchCacheKey(query, context);
    const cached = this.searchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.results;
    if (cached) this.searchCache.delete(cacheKey);
    const inFlight = this.searchInFlight.get(cacheKey);
    if (inFlight) return inFlight;

    const { first, settled } = this.fetchSearchResults(query, context, cacheKey);
    // Held until every source settles, not until the first answer, so a repeat
    // of the same query joins this run instead of starting a second one.
    this.searchInFlight.set(cacheKey, first);
    void settled.finally(() => {
      this.searchInFlight.delete(cacheKey);
    });
    return first;
  }

  /**
   * Brokers and the preferred provider run at once, rather than each being
   * awaited in turn. The old order tried brokers one at a time before the
   * preferred provider was asked at all, so one unreachable broker delayed
   * every lookup by its full timeout.
   *
   * Phrase searches stay on that first round. A symbol that came back from one
   * venue asks the other providers before the caller sees the list, so BIRD is
   * not only the first exchange that answered.
   *
   * Ordering still matters, it just no longer costs latency: `mergeSearchResults`
   * keeps the richest entry per symbol, so a broker arriving after the cloud
   * still upgrades the row, and `onPartial` hands that upgrade to the caller.
   */
  private fetchSearchResults(
    query: string,
    context: SearchRequestContext | undefined,
    cacheKey: string,
  ): { first: Promise<InstrumentSearchResult[]>; settled: Promise<void> } {
    const results: InstrumentSearchResult[] = [];
    const resultIndexByKey = new Map<string, number>();
    const timeoutMs = context?.interactive
      ? INTERACTIVE_SEARCH_TIMEOUT_MS
      : SEARCH_PROVIDER_TIMEOUT_MS;

    const cacheResults = (ttl = SEARCH_CACHE_TTL_MS) => {
      this.searchCache.set(cacheKey, {
        expiresAt: Date.now() + ttl,
        results: [...results],
      });
      if (this.searchCache.size > SEARCH_CACHE_MAX_ENTRIES) {
        this.searchCache.delete(this.searchCache.keys().next().value!);
      }
    };

    let resolveFirst!: (value: InstrumentSearchResult[]) => void;
    const first = new Promise<InstrumentSearchResult[]>((resolve) => {
      resolveFirst = resolve;
    });
    let answered = false;

    const record = (items: InstrumentSearchResult[] | null) => {
      if (!items?.length) return;
      mergeSearchResults(results, resultIndexByKey, items, context);
      cacheResults();
      if (!answered) {
        answered = true;
        // A copy: a later venue must not mutate the array already handed back.
        resolveFirst([...results]);
        return;
      }
      context?.onPartial?.([...results]);
    };

    const searchBroker = (candidate: BrokerCandidate) => (async () => {
      try {
        const items = await withSearchTimeout(
          candidate.broker.searchInstruments!(query, candidate.instance),
          timeoutMs,
        );
        record(items && annotateBrokerSearchResults(items, candidate));
      } catch {
        // A broker that cannot answer must not hold up the ones that can.
      }
    })();

    const searchProvider = (provider: DataProvider) => (async () => {
      try {
        record(await withSearchTimeout(provider.search(query, context), timeoutMs));
      } catch (error) {
        if (shouldLogProviderError(error)) {
          this.deps.logProviderError(`${provider.id} failed: ${error}`);
        }
      }
    })();

    const brokers = context?.preferBroker === false
      ? []
      : this.deps
        .getBrokerCandidates(context?.brokerInstanceId, context?.brokerId)
        .filter((candidate) => candidate.broker.searchInstruments);
    const [preferred, ...fallbacks] = this.deps.providersInPriorityOrder();

    const settled = (async () => {
      await Promise.allSettled([
        ...brokers.map(searchBroker),
        ...(preferred ? [searchProvider(preferred)] : []),
      ]);
      // A symbol typeahead often comes back as one venue. Ask the other
      // providers so BIRD on NASDAQ is not hidden behind a single IDX hit.
      // Phrase searches stay on the first answer; those fallbacks are metered.
      if (results.length === 0 || symbolSearchNeedsMoreVenues(query, results)) {
        await Promise.allSettled(fallbacks.map(searchProvider));
      }
    })().then(() => {
      if (!answered) {
        answered = true;
        if (results.length === 0) {
          // Nothing matched anywhere, so hold the empty answer briefly rather
          // than asking every source again on the next keystroke.
          cacheResults(Math.min(SEARCH_CACHE_TTL_MS, 5_000));
        }
        resolveFirst([...results]);
      }
    });

    return { first, settled };
  }
}

const SYMBOL_SEARCH = /^[A-Z0-9.]{1,8}$/;

/** The query is that symbol, and only one exchange has answered. Name searches stay put. */
function symbolSearchNeedsMoreVenues(query: string, results: InstrumentSearchResult[]): boolean {
  const symbol = query.trim().toUpperCase();
  if (!SYMBOL_SEARCH.test(symbol)) return false;
  const matches = results.filter((item) => item.symbol.trim().toUpperCase() === symbol);
  if (matches.length === 0) return false;
  const venues = new Set(
    matches
      .map((item) => (item.exchange || item.primaryExchange || "").trim().toUpperCase())
      .filter(Boolean),
  );
  return venues.size < 2;
}

function normalizeSearchKeyPart(value?: string): string {
  return (value ?? "").trim().toUpperCase();
}

function buildSearchResultKey(item: InstrumentSearchResult): string {
  return [
    normalizeSearchKeyPart(item.symbol),
    normalizeSearchKeyPart(item.exchange),
    normalizeSearchKeyPart(item.type),
    normalizeSearchKeyPart(item.primaryExchange),
    normalizeSearchKeyPart(item.currency),
  ].join("|");
}

function finiteListingActivity(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Keep whichever source actually reported activity. Do not invent a number. */
function mergeListingActivity(
  preferred: InstrumentSearchResult,
  other: InstrumentSearchResult,
): InstrumentSearchResult {
  const volume = finiteListingActivity(preferred.volume) ?? finiteListingActivity(other.volume);
  const averageVolume = finiteListingActivity(preferred.averageVolume) ?? finiteListingActivity(other.averageVolume);
  if (
    finiteListingActivity(preferred.volume) === volume
    && finiteListingActivity(preferred.averageVolume) === averageVolume
  ) {
    return preferred;
  }
  return {
    ...preferred,
    ...(volume != null ? { volume } : {}),
    ...(averageVolume != null ? { averageVolume } : {}),
  };
}

function getSearchResultRichness(item: InstrumentSearchResult, context?: SearchRequestContext): number {
  let score = 0;
  if (item.brokerContract) score += 500;
  if (item.brokerInstanceId) score += 250;
  if (item.brokerLabel) score += 100;
  if (item.name) score += Math.min(80, item.name.length);
  if (context?.brokerInstanceId && item.brokerInstanceId === context.brokerInstanceId) score += 800;
  if (context?.brokerId && item.brokerContract?.brokerId === context.brokerId) score += 400;
  return score;
}
