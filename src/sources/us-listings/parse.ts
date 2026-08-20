import type { UsListedSecurity, UsListingType, UsListingsUniverse } from "./types";
import {
  NASDAQ_LISTED_URL,
  OTHER_LISTED_URL,
  SEC_COMPANY_TICKERS_EXCHANGE_URL,
  US_LISTINGS_TTL_SECONDS,
} from "./types";

const OTHER_EXCHANGE_CODES: Record<string, string> = {
  A: "AMEX",
  N: "NYSE",
  P: "ARCA",
  Z: "BATS",
  V: "IEX",
};

const OTC_EXCHANGE_RE = /^(OTC|OTCQX|OTCQB|OTCBB|PINK|GREY|GRAY|EXPERT)$/i;

function classifyType(name: string, etfFlag: string): UsListingType {
  const upper = name.toUpperCase();
  if (etfFlag === "Y") {
    return upper.includes(" ETN") || upper.includes("EXCHANGE-TRADED NOTE") ? "ETN" : "ETF";
  }
  if (/\bWARRANTS?\b/.test(upper) || upper.includes(" WT")) return "WARRANT";
  if (/\bRIGHTS?\b/.test(upper)) return "RIGHT";
  if (/\bUNITS?\b/.test(upper)) return "UNIT";
  return "EQUITY";
}

function isYes(value: string | undefined): boolean {
  return (value ?? "").trim().toUpperCase() === "Y";
}

function parsePipeTable(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const rows: string[][] = [];
  let headers: string[] = [];
  for (const line of lines) {
    if (/^file creation time/i.test(line)) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    if (headers.length === 0) {
      headers = cells.map((cell) => cell.toUpperCase());
      continue;
    }
    if (cells.length < 2) continue;
    rows.push(cells);
  }
  return { headers, rows };
}

function headerIndex(headers: string[], ...names: string[]): number {
  for (const name of names) {
    const index = headers.indexOf(name.toUpperCase());
    if (index >= 0) return index;
  }
  return -1;
}

export function parseNasdaqListedFile(text: string): UsListedSecurity[] {
  const { headers, rows } = parsePipeTable(text);
  const symbolIdx = headerIndex(headers, "Symbol");
  const nameIdx = headerIndex(headers, "Security Name");
  const testIdx = headerIndex(headers, "Test Issue");
  const etfIdx = headerIndex(headers, "ETF");
  if (symbolIdx < 0 || nameIdx < 0) return [];

  const out: UsListedSecurity[] = [];
  for (const row of rows) {
    if (testIdx >= 0 && isYes(row[testIdx])) continue;
    const symbol = (row[symbolIdx] ?? "").trim().toUpperCase();
    const name = (row[nameIdx] ?? "").trim();
    if (!symbol || !name) continue;
    out.push({
      symbol,
      name,
      exchange: "NASDAQ",
      type: classifyType(name, (row[etfIdx] ?? "N").toUpperCase()),
      source: "nasdaqlisted",
    });
  }
  return out;
}

export function parseOtherListedFile(text: string): UsListedSecurity[] {
  const { headers, rows } = parsePipeTable(text);
  const symbolIdx = headerIndex(headers, "ACT Symbol", "Symbol");
  const nameIdx = headerIndex(headers, "Security Name");
  const exchangeIdx = headerIndex(headers, "Exchange");
  const testIdx = headerIndex(headers, "Test Issue");
  const etfIdx = headerIndex(headers, "ETF");
  if (symbolIdx < 0 || nameIdx < 0 || exchangeIdx < 0) return [];

  const out: UsListedSecurity[] = [];
  for (const row of rows) {
    if (testIdx >= 0 && isYes(row[testIdx])) continue;
    const symbol = (row[symbolIdx] ?? "").trim().toUpperCase();
    const name = (row[nameIdx] ?? "").trim();
    const exchange = OTHER_EXCHANGE_CODES[(row[exchangeIdx] ?? "").trim().toUpperCase()];
    if (!symbol || !name || !exchange) continue;
    out.push({
      symbol,
      name,
      exchange,
      type: classifyType(name, (row[etfIdx] ?? "N").toUpperCase()),
      source: "otherlisted",
    });
  }
  return out;
}

export function parseSecCompanyTickersExchange(body: unknown): UsListedSecurity[] {
  if (!body || typeof body !== "object") return [];
  const record = body as { fields?: unknown; data?: unknown };
  if (!Array.isArray(record.fields) || !Array.isArray(record.data)) return [];

  const fields = record.fields.map((field) => String(field).toLowerCase());
  const tickerIdx = fields.indexOf("ticker");
  const nameIdx = fields.indexOf("name");
  const exchangeIdx = fields.indexOf("exchange");
  if (tickerIdx < 0 || nameIdx < 0 || exchangeIdx < 0) return [];

  const out: UsListedSecurity[] = [];
  for (const row of record.data) {
    if (!Array.isArray(row)) continue;
    const symbol = String(row[tickerIdx] ?? "").trim().toUpperCase();
    const name = String(row[nameIdx] ?? "").trim();
    const exchangeRaw = String(row[exchangeIdx] ?? "").trim();
    if (!symbol || !name) continue;
    const venue = exchangeRaw.toUpperCase().replace(/\s+/g, "");
    if (!OTC_EXCHANGE_RE.test(venue) && !/OTC/.test(venue)) continue;
    out.push({
      symbol,
      name,
      exchange: "OTC",
      type: classifyType(name, "N"),
      source: "sec-otc",
    });
  }
  return out;
}

export function mergeUsListings(parts: {
  nasdaqlisted: UsListedSecurity[];
  otherlisted: UsListedSecurity[];
  secOtc: UsListedSecurity[];
  asOf?: string;
}): UsListingsUniverse {
  const bySymbol = new Map<string, UsListedSecurity>();
  for (const security of parts.nasdaqlisted) bySymbol.set(security.symbol, security);
  for (const security of parts.otherlisted) {
    if (!bySymbol.has(security.symbol)) bySymbol.set(security.symbol, security);
  }
  for (const security of parts.secOtc) {
    if (!bySymbol.has(security.symbol)) bySymbol.set(security.symbol, security);
  }

  const securities = [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
  return {
    asOf: parts.asOf ?? new Date().toISOString(),
    ttlSeconds: US_LISTINGS_TTL_SECONDS,
    sources: [
      { id: "nasdaqlisted", url: NASDAQ_LISTED_URL, ttlSeconds: US_LISTINGS_TTL_SECONDS },
      { id: "otherlisted", url: OTHER_LISTED_URL, ttlSeconds: US_LISTINGS_TTL_SECONDS },
      { id: "sec-otc", url: SEC_COMPANY_TICKERS_EXCHANGE_URL, ttlSeconds: US_LISTINGS_TTL_SECONDS },
    ],
    securities,
  };
}

export function universeToPrint(universe: UsListingsUniverse) {
  return {
    asOf: universe.asOf,
    ttlSeconds: universe.ttlSeconds,
    sources: universe.sources,
    securities: universe.securities.map((security) => ({
      s: security.symbol,
      n: security.name,
      e: security.exchange,
      t: security.type,
      src: security.source,
    })),
  };
}

export function printToUniverse(print: {
  asOf?: unknown;
  ttlSeconds?: unknown;
  sources?: unknown;
  securities?: unknown;
}): UsListingsUniverse | null {
  if (!Array.isArray(print.securities)) return null;
  const securities: UsListedSecurity[] = [];
  for (const row of print.securities) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const symbol = typeof item.s === "string" ? item.s.trim().toUpperCase() : "";
    const name = typeof item.n === "string" ? item.n.trim() : "";
    const exchange = typeof item.e === "string" ? item.e.trim().toUpperCase() : "";
    const type = item.t as UsListingType;
    const source = item.src as UsListedSecurity["source"];
    if (!symbol || !name || !exchange) continue;
    if (type !== "EQUITY" && type !== "ETF" && type !== "ETN" && type !== "WARRANT" && type !== "RIGHT" && type !== "UNIT") {
      continue;
    }
    if (source !== "nasdaqlisted" && source !== "otherlisted" && source !== "sec-otc") continue;
    securities.push({ symbol, name, exchange, type, source });
  }
  if (securities.length === 0) return null;
  const ttlSeconds = typeof print.ttlSeconds === "number" && Number.isFinite(print.ttlSeconds)
    ? print.ttlSeconds
    : US_LISTINGS_TTL_SECONDS;
  return {
    asOf: typeof print.asOf === "string" ? print.asOf : new Date().toISOString(),
    ttlSeconds,
    sources: Array.isArray(print.sources)
      ? print.sources as UsListingsUniverse["sources"]
      : [],
    securities,
  };
}
