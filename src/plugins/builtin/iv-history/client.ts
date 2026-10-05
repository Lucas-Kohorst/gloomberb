import { impliedVolatility } from "../../../api-client/implied-volatility";
import { parsePublicTickerKey } from "../../../utils/exchanges";
import type { InstrumentRef } from "../../../market-data/request-types";
import type { DataProvider } from "../../../types/data-provider";
import type { PricePoint } from "../../../types/financials";
import { withConnectionRequest } from "../connections/register";
import { realizedVolatility, realizedVolatilityCadenceIssue } from "./realized";

export const IV_CONNECTION_ID = "gloom-cloud-iv";

export type IvMethod = "quote-mid" | "trade-close";
type IvCoverageStatus = "ready" | "backfilling" | "queued" | "unavailable";
export interface IvPoint {
  sessionDate: string;
  method: IvMethod;
  capturedAt: string;
  spot: number | null;
  iv7: number | null;
  iv30: number | null;
  iv60: number | null;
  iv90: number | null;
  iv180: number | null;
  iv365: number | null;
  put25_30: number | null;
  call25_30: number | null;
}
export interface IvStats {
  value: number;
  date: string;
  method: IvMethod;
  rank: number | null;
  percentile: number | null;
  low: number | null;
  high: number | null;
  samples: number;
  windowStart: string | null;
}
interface IvReading {
  date: string;
  method: IvMethod;
  capturedAt: string;
  spot: number | null;
  iv7: number | null;
  iv30: number | null;
  iv60: number | null;
  iv90: number | null;
  iv180: number | null;
  iv365: number | null;
}
export interface IvHistoryPayload {
  version: 1;
  symbol: string;
  asOf: string;
  status: IvCoverageStatus;
  coverage: { source: "seed" | "demand"; addedAt: string; backfilledThrough: string | null; since: string | null } | null;
  stats: { iv30: IvStats | null; iv90: IvStats | null };
  latest: IvReading | null;
  series: IvPoint[];
  warnings: string[];
}
export interface IvScreenRow {
  symbol: string;
  status: "ready" | "queued";
  iv30: IvStats | null;
  iv90: IvStats | null;
  latest: IvReading | null;
  skew: { date: string; put25: number; call25: number; skew: number } | null;
}
export interface IvScreenPayload { version: 1; asOf: string; rows: IvScreenRow[] }
export interface StoredSurfacePayload {
  version: 1;
  symbol: string;
  sessionDate: string;
  capturedAt: string;
  spot: number;
  surface: Record<string, unknown>;
}

export interface ImpliedVolatilityApi {
  impliedVolatility<T>(path: string, init?: RequestInit): Promise<T>;
}
const query = (params: Record<string, string>) => new URLSearchParams(params).toString();
/** Stored IV is keyed by the bare US symbol; a listing key ("SPY:ARCX") drops its exchange. */
export const ivSymbol = (symbol: string) => parsePublicTickerKey(symbol.trim()).symbol.toUpperCase();

const cloudApi: ImpliedVolatilityApi = {
  impliedVolatility: (path, init) => withConnectionRequest(IV_CONNECTION_ID, "iv", () => impliedVolatility(path, init)),
};

export function loadIvHistory(symbol: string, options: { signal?: AbortSignal; days?: number } = {}, api: ImpliedVolatilityApi = cloudApi) {
  return api.impliedVolatility<IvHistoryPayload>(`history?${query({ symbol: ivSymbol(symbol), days: String(options.days ?? 1100) })}`,
    { signal: options.signal });
}
export function loadIvScreen(symbols: readonly string[], options: { signal?: AbortSignal } = {}, api: ImpliedVolatilityApi = cloudApi) {
  return api.impliedVolatility<IvScreenPayload>(`screen?${query({ symbols: symbols.map(ivSymbol).join(",") })}`, { signal: options.signal });
}
export function loadSurfaceDates(symbol: string, options: { signal?: AbortSignal } = {}, api: ImpliedVolatilityApi = cloudApi) {
  return api.impliedVolatility<{ version: 1; symbol: string; dates: string[] }>(`surface-dates?${query({ symbol: ivSymbol(symbol) })}`,
    { signal: options.signal });
}
export function loadStoredSurface(symbol: string, date: string, options: { signal?: AbortSignal } = {}, api: ImpliedVolatilityApi = cloudApi) {
  return api.impliedVolatility<StoredSurfacePayload>(`surface?${query({ symbol: ivSymbol(symbol), date })}`, { signal: options.signal });
}

async function loadPriceHistory(instrument: InstrumentRef, marketData?: DataProvider): Promise<PricePoint[]> {
  const coordinator = await import("../../../market-data/coordinator");
  const owner = marketData ? new coordinator.MarketDataCoordinator(marketData) : coordinator.getSharedMarketDataCoordinator();
  if (!owner) return [];
  try {
    const entry = await owner.loadChart({ instrument, bufferRange: "5Y", granularity: "resolution", resolution: "1d" });
    const history = coordinator.resolveEntryValue(entry) ?? [];
    return realizedVolatilityCadenceIssue(history) ? [] : history;
  } catch {
    return [];
  }
}

export async function loadIvPriceHistory(instrument: InstrumentRef, marketData?: DataProvider): Promise<PricePoint[]> {
  return loadPriceHistory(instrument, marketData);
}

/** Close-to-close HV over one window for each symbol from one year of daily closes, four at a time. */
export async function loadRealizedVolatilities(
  instruments: readonly InstrumentRef[], window: number, options: { signal?: AbortSignal; onValue?: (symbol: string, value: number | null) => void } = {},
  marketData?: DataProvider,
): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>();
  let next = 0;
  const worker = async () => {
    while (next < instruments.length && !options.signal?.aborted) {
      const instrument = instruments[next++]!;
      const history = await loadPriceHistory(instrument, marketData);
      const value = history.length ? realizedVolatility(history, window) : null;
      result.set(instrument.symbol, value);
      options.onValue?.(instrument.symbol, value);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, instruments.length) }, worker));
  return result;
}
