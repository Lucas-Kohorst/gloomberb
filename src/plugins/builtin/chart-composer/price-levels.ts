import { parsePublicTickerKey, publicTickerKey } from "../../../utils/exchanges";
import type { ChartSpec } from "../../../time-series/types";

/**
 * Horizontal price levels drawn on a ticker. They live in the synced plugin
 * config keyed by listing, not in a pane, so every chart of the ticker shows
 * them and they follow the account to other machines.
 */
export const PRICE_LEVELS_KEY = "priceLevels";
export const DEFAULT_LEVEL_COLOR = "#f5a524";
/** A level that already has a price alert, and an alert with no drawn twin. */
export const ALERT_LEVEL_COLOR = "#ff6b6b";
const MAX_LEVELS_PER_TICKER = 24;
const MAX_TICKERS = 400;

export interface PriceLevel {
  id: string;
  price: number;
  color: string;
}

export type PriceLevelStore = Record<string, PriceLevel[]>;

export type PriceLevelEdit =
  | { kind: "add"; id: string; price: number }
  | { kind: "move"; id: string; price: number }
  | { kind: "remove"; id: string };

export interface PriceLevelListing {
  key: string;
  seriesId: string;
  symbol: string;
  exchange?: string;
}

type FuturesGenericRoll =
  | { rule: "open-interest" }
  | { rule: "first-notice"; days: number }
  | { rule: "fixed-day"; day: number };

interface FuturesGeneric {
  root: string;
  position: number;
}

/** Roots Gloom Cloud archives daily, by the venue that lists them. */
const ROOT_VENUES: Readonly<Record<string, string>> = Object.fromEntries(([
  ["CME", ["ES", "NQ", "RTY", "6E", "6J", "6B", "6A", "6C", "6S", "SR3", "LE", "GF", "HE", "LBR", "DC", "CSC", "GD", "BTC", "ETH", "SOL", "XRP"]],
  ["CBT", ["YM", "ZT", "ZF", "ZN", "ZB", "UB", "ZQ", "ZC", "ZS", "ZW", "ZM", "ZL", "KE", "ZO", "ZR"]],
  ["NYM", ["CL", "BZ", "NG", "RB", "HO", "PL", "PA", "B0", "TTF"]],
  ["CMX", ["GC", "SI", "HG", "ALI", "HRC", "UX"]],
  ["NYB", ["KC", "SB", "CC", "CT", "OJ"]],
  ["CFE", ["VX"]],
] as const).flatMap(([venue, roots]) => roots.map((root) => [root, venue])));

const VENUE_NAMES: Readonly<Record<string, readonly string[]>> = {
  NYM: ["NYMEX", "NY MERCANTILE"],
  CBT: ["CBOT"],
  CMX: ["COMEX"],
  NYB: ["ICE FUTURES", "NYBOT"],
  CFE: ["CBOE FUTURES"],
};

const ALIASES: Readonly<Record<string, string>> = {
  TY: "ZN", US: "ZB", FV: "ZF", TU: "ZT", WN: "UB", DM: "YM", FF: "ZQ", SFR: "SR3",
  CO: "BZ", XB: "RB", LC: "LE", LH: "HE", FC: "GF", SM: "ZM", BO: "ZL", KW: "KE",
};

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseFuturesGeneric(value: string): FuturesGeneric | null {
  const ticker = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) return null;
  for (let length = Math.min(4, ticker.length - 1); length >= 1; length -= 1) {
    const prefix = ticker.slice(0, length);
    const root = ALIASES[prefix] ?? prefix;
    if (!ROOT_VENUES[root]) continue;
    const match = /^(\d{1,2})(?:([FD])(\d{1,2}))?([RA])?$/.exec(ticker.slice(length));
    if (!match) continue;
    const position = Number(match[1]);
    if (match[1]!.startsWith("0") || position < 1 || position > 24) return null;
    const amount = match[3] == null ? 0 : Number(match[3]);
    const roll: FuturesGenericRoll = match[2] === "F"
      ? { rule: "first-notice", days: amount }
      : match[2] === "D"
        ? { rule: "fixed-day", day: amount }
        : { rule: "open-interest" };
    if (roll.rule === "first-notice" && roll.days > 30) return null;
    if (roll.rule === "fixed-day" && (roll.day < 1 || roll.day > 28)) return null;
    return { root, position };
  }
  return null;
}

/**
 * A generic future is keyed by root and position alone. Its venue follows from
 * the root, and Roll/Adjust rewrites the ticker (CL1F5R) without changing the
 * price the levels mark. A name that only spells like a generic (PL8 on ASX)
 * keeps its listing.
 */
function futuresGenericKey(symbol: string, exchange?: string): string | null {
  const key = parsePublicTickerKey(symbol);
  const generic = parseFuturesGeneric(key.symbol);
  if (!generic) return null;
  const venue = (key.exchange || exchange || "").trim().toUpperCase();
  const own = ROOT_VENUES[generic.root]!;
  if (venue && venue !== own && !VENUE_NAMES[own]?.includes(venue)) return null;
  return `${generic.root}${generic.position}`;
}

export function priceLevelTickerKey(symbol: string, exchange?: string): string {
  return futuresGenericKey(symbol, exchange) ?? publicTickerKey(symbol, exchange);
}

/** The first visible price series, which is the listing levels belong to. */
export function priceLevelListing(spec: ChartSpec): PriceLevelListing | null {
  for (const series of spec.series) {
    if (series.visible === false) continue;
    const source = series.source;
    if (source.kind !== "security") continue;
    if (source.fieldId !== "market.ohlcv" && source.fieldId !== "market.close") continue;
    const symbol = source.instrument.symbol.trim();
    if (!symbol) continue;
    const exchange = source.instrument.exchange?.trim() || undefined;
    return {
      key: priceLevelTickerKey(symbol, exchange),
      seriesId: series.id,
      symbol,
      exchange,
    };
  }
  return null;
}

function parseLevel(value: unknown): PriceLevel | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { id, price, color } = value as Record<string, unknown>;
  if (typeof id !== "string" || !id || id.length > 80 || !finiteNumber(price)) return null;
  return {
    id,
    price,
    color: typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_LEVEL_COLOR,
  };
}

/**
 * The stored levels, dropping anything malformed rather than the whole store.
 * An edit moves its listing to the end, so past the cap the listings edited
 * longest ago go, never the one just drawn on.
 */
export function parsePriceLevels(value: unknown): PriceLevelStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const store: PriceLevelStore = {};
  for (const [key, entries] of Object.entries(value as Record<string, unknown>).slice(-MAX_TICKERS)) {
    if (!key || !Array.isArray(entries)) continue;
    const levels = entries.flatMap((entry) => parseLevel(entry) ?? []).slice(0, MAX_LEVELS_PER_TICKER);
    if (levels.length > 0) store[key] = levels;
  }
  return store;
}

export function editPriceLevels(store: PriceLevelStore, key: string, edit: PriceLevelEdit): PriceLevelStore {
  const current = store[key] ?? [];
  // A second add at the same price would stack an identical level. The prompt
  // removes that price instead, so this stays a no-op for any other caller.
  if (edit.kind === "add" && current.some((level) => level.price === edit.price && level.id !== edit.id)) return store;
  if (edit.kind === "move") {
    const existing = current.find((level) => level.id === edit.id);
    if (!existing || existing.price === edit.price) return store;
  }
  if (edit.kind === "remove" && !current.some((level) => level.id === edit.id)) return store;
  const next = edit.kind === "add"
    ? [...current.filter((level) => level.id !== edit.id), { id: edit.id, price: edit.price, color: DEFAULT_LEVEL_COLOR }]
      .slice(-MAX_LEVELS_PER_TICKER)
    : edit.kind === "move"
      ? current.map((level) => level.id === edit.id ? { ...level, price: edit.price } : level)
      : current.filter((level) => level.id !== edit.id);
  const { [key]: _previous, ...rest } = store;
  return next.length > 0 ? { ...rest, [key]: next } : rest;
}
