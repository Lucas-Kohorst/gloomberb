import {
  CORPORATE_YIELD_CATALOG,
  CREDIT_SPREAD_CATALOG,
  TREASURY_CATALOG,
} from "../chart-composer/universal-series";
import { CHART_COMPOSER_TEMPLATE_ID } from "../shared/graph-pop-out";
import { FUTURES_CONTRACTS } from "../futures/contracts";
import type { InstrumentSearchResult } from "../../../types/instrument";

export type BondSearchKind = "series" | "instrument";

export interface BondSearchHit {
  id: string;
  kind: BondSearchKind;
  label: string;
  detail: string;
  right: string;
  searchText: string;
  /** Chart expression for series hits. */
  expression?: string;
  /** Ticker to pin for live instrument hits. */
  symbol?: string;
  templateId: string;
  arg: string;
}

export interface BondSearchOptions {
  searchInstruments?: (query: string) => Promise<InstrumentSearchResult[]>;
}

export interface BondSearchResult {
  hits: BondSearchHit[];
  instrumentError?: string;
}

const BOND_TYPE_RE = /\b(bond|bonds|bill|note|tips|frn|cmb|fixed[\s-]?inc|debt|gilt|bund)\b/i;
const BOND_NAME_RE =
  /\b(treasury|t-?bond|t-?note|t-?bill|tips|muni(?:cipal)?|high[\s-]?yield|\bhy\b|investment[\s-]?grade|\big\b|aggregate|corp(?:orate)?[\s-]?bond|credit[\s-]?spread|oas)\b/i;
const LIVE_QUERY_MIN = 2;
const MAX_LIVE_HITS = 20;

function tokensMatch(haystack: string, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return normalized.split(/\s+/).every((token) => haystack.includes(token));
}

export function isBondLikeSearchResult(result: InstrumentSearchResult): boolean {
  const type = result.type.trim();
  const name = result.name.trim();
  const symbol = result.symbol.trim();
  if (BOND_TYPE_RE.test(type)) return true;
  if (BOND_NAME_RE.test(name) || BOND_NAME_RE.test(symbol)) return true;
  return false;
}

function catalogSearchText(...parts: string[]): string {
  return parts.join(" ").toLowerCase();
}

export function catalogBondHits(): BondSearchHit[] {
  const treasuries: BondSearchHit[] = TREASURY_CATALOG.map((entry) => {
    const expression = `UST:${entry.maturity}`;
    return {
      id: `series:${expression}`,
      kind: "series",
      label: entry.label,
      detail: expression,
      right: "UST",
      searchText: catalogSearchText(
        entry.label,
        entry.maturity,
        entry.seriesId,
        expression,
        "treasury bond yield ust",
      ),
      expression,
      templateId: CHART_COMPOSER_TEMPLATE_ID,
      arg: expression,
    };
  });

  const corporates: BondSearchHit[] = CORPORATE_YIELD_CATALOG.map((entry) => {
    const expression = `FRED:${entry.seriesId}`;
    return {
      id: `series:${expression}`,
      kind: "series",
      label: entry.label,
      detail: expression,
      right: "FRED",
      searchText: catalogSearchText(
        entry.label,
        entry.seriesId,
        expression,
        "corporate bond yield ice bofa ig hy",
      ),
      expression,
      templateId: CHART_COMPOSER_TEMPLATE_ID,
      arg: expression,
    };
  });

  const credit: BondSearchHit[] = CREDIT_SPREAD_CATALOG.map((entry) => {
    const expression = `FRED:${entry.seriesId}`;
    return {
      id: `series:${expression}`,
      kind: "series",
      label: entry.label,
      detail: expression,
      right: "FRED",
      searchText: catalogSearchText(
        entry.label,
        entry.seriesId,
        expression,
        "credit spread oas bond",
      ),
      expression,
      templateId: CHART_COMPOSER_TEMPLATE_ID,
      arg: expression,
    };
  });

  const futures: BondSearchHit[] = FUTURES_CONTRACTS
    .filter((contract) => contract.sector === "rates")
    .map((contract) => {
      const expression = `FUT:${contract.code}`;
      return {
        id: `series:${expression}`,
        kind: "series",
        label: contract.name,
        detail: expression,
        right: "FUT",
        searchText: catalogSearchText(
          contract.name,
          contract.code,
          contract.symbol,
          expression,
          "treasury bond note futures",
        ),
        expression,
        templateId: CHART_COMPOSER_TEMPLATE_ID,
        arg: expression,
      };
    });

  return [...treasuries, ...corporates, ...credit, ...futures];
}

export function instrumentToHit(result: InstrumentSearchResult, index: number): BondSearchHit {
  const symbol = result.symbol.trim().toUpperCase();
  const type = result.type.trim() || "BOND";
  return {
    id: `instrument:${result.providerId}:${symbol}:${result.exchange}:${index}`,
    kind: "instrument",
    label: result.name.trim() || symbol,
    detail: [symbol, result.exchange].filter(Boolean).join(" · "),
    right: type,
    searchText: catalogSearchText(result.name, symbol, result.exchange, type),
    symbol,
    templateId: "ticker-research",
    arg: symbol,
  };
}

function scoreHit(hit: BondSearchHit, query: string): number {
  const q = query.trim().toLowerCase();
  const seriesBoost = hit.kind === "series" ? 20 : 0;
  if (!q) return seriesBoost;
  const label = hit.label.toLowerCase();
  const arg = hit.arg.toLowerCase();
  const symbol = (hit.symbol ?? "").toLowerCase();
  if (label === q || arg === q || symbol === q) return 300 + seriesBoost;
  if (label.startsWith(q) || symbol.startsWith(q) || arg.endsWith(q)) return 200 + seriesBoost;
  if (hit.searchText.includes(q)) return 100 + seriesBoost;
  return 10 + seriesBoost;
}

export async function searchBonds(
  query: string,
  options: BondSearchOptions = {},
): Promise<BondSearchResult> {
  const catalog = catalogBondHits().filter((hit) => tokensMatch(hit.searchText, query));
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < LIVE_QUERY_MIN || !options.searchInstruments) {
    return {
      hits: [...catalog].sort((left, right) => scoreHit(right, trimmed) - scoreHit(left, trimmed)),
    };
  }

  let live: InstrumentSearchResult[] = [];
  let instrumentError: string | undefined;
  try {
    live = await options.searchInstruments(trimmed);
  } catch (error) {
    instrumentError = error instanceof Error ? error.message : String(error);
  }

  const seen = new Set(catalog.map((hit) => hit.arg.toUpperCase()));
  const instruments: BondSearchHit[] = [];
  for (const [index, result] of live.entries()) {
    if (!isBondLikeSearchResult(result)) continue;
    const symbol = result.symbol.trim().toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    instruments.push(instrumentToHit(result, index));
    if (instruments.length >= MAX_LIVE_HITS) break;
  }

  const hits = [...catalog, ...instruments].sort(
    (left, right) => scoreHit(right, trimmed) - scoreHit(left, trimmed),
  );
  return { hits, instrumentError };
}
