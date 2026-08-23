/**
 * Filter parsing and application for the fundamental screener.
 */

import type { ScreenerFilters, ScreenerResult } from "./types";

export { DEFAULT_FILTERS } from "./types";

type RangeField = "marketCap" | "peRatio" | "pbRatio" | "debtToEquity" | "revenueGrowth" | "margin" | "dividendYield";

type ParsedToken =
  | { kind: "range"; field: RangeField; op: "<" | ">" | "="; value: number; isPercent: boolean }
  | { kind: "sector"; value: string }
  | { kind: "exchange"; value: string }
  | { kind: "marginKind"; value: "gross" | "net" };

interface FieldSpec {
  field: RangeField;
  aliases: string[];
  isPercent: boolean;
}

const RANGE_FIELDS: FieldSpec[] = [
  { field: "marketCap", aliases: ["mcap", "marketcap", "cap"], isPercent: false },
  { field: "peRatio", aliases: ["pe", "peratio"], isPercent: false },
  { field: "pbRatio", aliases: ["pb", "pbratio", "ptb"], isPercent: false },
  { field: "debtToEquity", aliases: ["de", "d2e", "debttoequity", "debtequity"], isPercent: false },
  { field: "revenueGrowth", aliases: ["revgrowth", "revg", "growth", "revenuegrowth"], isPercent: true },
  { field: "margin", aliases: ["margin", "m"], isPercent: true },
  { field: "dividendYield", aliases: ["div", "divy", "dividend", "yield", "dividendyield"], isPercent: true },
];

const SECTOR_ALIASES = ["sector", "sec"];
const EXCHANGE_ALIASES = ["exchange", "exch", "ex"];
const MARGIN_KIND_ALIASES = ["marginkind", "mk"];

function tokenize(input: string): string[] {
  return input.trim().split(/\s+/).filter((s) => s.length > 0);
}

/**
 * Parse a single token like "pe<20", "mcap>1B", "sector=tech".
 * Returns null if the token doesn't match any known pattern.
 */
function parseToken(raw: string): ParsedToken | null {
  const token = raw.toLowerCase();

  // Check for sector/exchange/marginKind first (alpha=keyword patterns)
  for (const alias of SECTOR_ALIASES) {
    if (token.startsWith(alias + "=")) {
      return { kind: "sector", value: raw.slice(alias.length + 1) };
    }
  }
  for (const alias of EXCHANGE_ALIASES) {
    if (token.startsWith(alias + "=")) {
      return { kind: "exchange", value: raw.slice(alias.length + 1) };
    }
  }
  for (const alias of MARGIN_KIND_ALIASES) {
    if (token.startsWith(alias + "=")) {
      const val = raw.slice(alias.length + 1).toLowerCase();
      if (val === "gross" || val === "net") {
        return { kind: "marginKind", value: val };
      }
    }
  }

  // Range filter patterns: field<value, field>value, field=value
  const opMatch = token.match(/^([a-z]+)\s*([<>=])\s*(.+)$/);
  if (!opMatch) {
    // Try bare sector keywords like "tech", "health", "energy"
    const bareSector = parseBareSector(token);
    if (bareSector) return { kind: "sector", value: bareSector };
    return null;
  }

  const aliasPart = opMatch[1];
  const op = opMatch[2];
  const valuePart = opMatch[3];
  if (!aliasPart || !op || !valuePart) return null;

  for (const spec of RANGE_FIELDS) {
    if (spec.aliases.includes(aliasPart)) {
      const parsed = parseNumericValue(valuePart, spec.isPercent);
      if (parsed == null) return null;
      return {
        kind: "range",
        field: spec.field,
        op: op as "<" | ">" | "=",
        value: parsed,
        isPercent: spec.isPercent,
      };
    }
  }

  return null;
}

/**
 * Recognize bare sector keywords like "tech", "health", "energy", "finance".
 */
function parseBareSector(token: string): string | null {
  const sectors = [
    "technology", "tech",
    "healthcare", "health", "medical",
    "financials", "finance", "financial",
    "consumer", "discretionary", "staples",
    "energy",
    "materials", "industrials", "industrial",
    "utilities", "utility",
    "realestate", "reit", "real",
    "communication", "communications", "comm",
    "semiconductor", "semi", "semis",
  ];
  return sectors.includes(token) ? token : null;
}

/**
 * Parse a numeric value with optional suffixes:
 * - B/b = billions (1e9)
 * - T/t = trillions (1e12)
 * - M/m = millions (1e6, only when preceded by a digit)
 * - % = percentage (divide by 100 for stored fraction)
 */
function parseNumericValue(raw: string, isPercentField: boolean): number | null {
  const cleaned = raw.trim();
  if (cleaned.length === 0) return null;

  let multiplier = 1;
  let valuePart = cleaned;

  if (valuePart.endsWith("%")) {
    valuePart = valuePart.slice(0, -1);
    if (!isPercentField) return null; // % only valid on percent fields
    multiplier = 0.01;
  } else if (isPercentField) {
    // For percent fields without %, assume the value is already a percentage (e.g. "20" = 20%)
    multiplier = 0.01;
  }

  // Suffix multipliers for large numbers
  if (valuePart.length > 0) {
    const last = valuePart[valuePart.length - 1]!;
    if (last === "B" || last === "b") {
      multiplier *= 1e9;
      valuePart = valuePart.slice(0, -1);
    } else if (last === "T" || last === "t") {
      multiplier *= 1e12;
      valuePart = valuePart.slice(0, -1);
    } else if (last === "M" || last === "m") {
      // Only treat as millions suffix if preceded by a digit
      const before = valuePart.slice(0, -1);
      if (before.length > 0 && /[0-9]$/.test(before)) {
        multiplier *= 1e6;
        valuePart = before;
      }
    }
  }

  const num = Number(valuePart);
  if (!Number.isFinite(num)) return null;
  return num * multiplier;
}

/**
 * Parse a full command-bar argument string into a ScreenerFilters object.
 * Example: "tech pe<20 mcap>1B div>2%"
 */
export function parseFilterArgs(args: string): ScreenerFilters {
  const filters: ScreenerFilters = {
    marketCap: { min: null, max: null },
    peRatio: { min: null, max: null },
    pbRatio: { min: null, max: null },
    debtToEquity: { min: null, max: null },
    revenueGrowth: { min: null, max: null },
    margin: { min: null, max: null },
    marginKind: "net",
    dividendYield: { min: null, max: null },
    sector: null,
    exchange: null,
  };

  const tokens = tokenize(args);
  for (const raw of tokens) {
    const parsed = parseToken(raw);
    if (!parsed) continue;

    if (parsed.kind === "range") {
      const range = filters[parsed.field];
      if (parsed.op === "<") {
        range.max = parsed.value;
      } else if (parsed.op === ">") {
        range.min = parsed.value;
      } else {
        range.min = parsed.value;
        range.max = parsed.value;
      }
    } else if (parsed.kind === "sector") {
      filters.sector = parsed.value;
    } else if (parsed.kind === "exchange") {
      filters.exchange = parsed.value;
    } else if (parsed.kind === "marginKind") {
      filters.marginKind = parsed.value;
    }
  }

  return filters;
}

// ── Filter application ─────────────────────────────────────────────

function matchRange(value: number | null, range: { min: number | null; max: number | null }): boolean {
  if (value == null) return false;
  if (range.min != null && value < range.min) return false;
  if (range.max != null && value > range.max) return false;
  return true;
}

function matchOptionalRange(
  value: number | null,
  range: { min: number | null; max: number | null },
): boolean {
  // If both bounds are null, the filter is inactive — everything passes
  if (range.min == null && range.max == null) return true;
  return matchRange(value, range);
}

function sectorMatches(resultSector: string | null, filterSector: string | null): boolean {
  if (filterSector == null) return true;
  if (resultSector == null) return false;
  return resultSector.toLowerCase().includes(filterSector.toLowerCase());
}

function exchangeMatches(resultExchange: string, filterExchange: string | null): boolean {
  if (filterExchange == null) return true;
  return resultExchange.toLowerCase().includes(filterExchange.toLowerCase());
}

/**
 * Apply screener filters to a list of results.
 * A result passes only if it satisfies every active filter.
 * Inactive filters (null bounds/sector/exchange) are skipped.
 */
export function applyFilters(
  results: ScreenerResult[],
  filters: ScreenerFilters,
): ScreenerResult[] {
  return results.filter((r) => {
    if (!matchOptionalRange(r.marketCap, filters.marketCap)) return false;
    if (!matchOptionalRange(r.peRatio, filters.peRatio)) return false;
    if (!matchOptionalRange(r.pbRatio, filters.pbRatio)) return false;
    if (!matchOptionalRange(r.debtToEquity, filters.debtToEquity)) return false;
    if (!matchOptionalRange(r.revenueGrowth, filters.revenueGrowth)) return false;

    const marginValue = filters.marginKind === "gross" ? r.grossMargin : r.netMargin;
    if (!matchOptionalRange(marginValue, filters.margin)) return false;

    if (!matchOptionalRange(r.dividendYield, filters.dividendYield)) return false;
    if (!sectorMatches(r.sector, filters.sector)) return false;
    if (!exchangeMatches(r.exchange, filters.exchange)) return false;
    return true;
  });
}

/**
 * Count how many filters are active (non-default).
 */
export function activeFilterCount(filters: ScreenerFilters): number {
  let count = 0;
  const ranges: RangeField[] = [
    "marketCap", "peRatio", "pbRatio", "debtToEquity",
    "revenueGrowth", "margin", "dividendYield",
  ];
  for (const key of ranges) {
    const range = filters[key];
    if (range.min != null || range.max != null) count++;
  }
  if (filters.sector != null) count++;
  if (filters.exchange != null) count++;
  return count;
}
