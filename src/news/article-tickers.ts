/**
 * Shared ticker extractor for tweets, RSS, Substack, and wire headlines.
 *
 * Trusted mentions (always kept, stopwords excluded):
 *   $NVDA  (AAPL)  NASDAQ:MSFT
 * Cashtags: crypto ($BTC/$ETH/$SOL) always; dotted/hyphen ($BRK.B, $BF-B) if
 * they exist in the catalog snapshot.
 * Bare tokens: mega-caps or the user's book only — never the full catalog.
 * Company names: watchlist + catalog snapshot (not mega-caps alone).
 * RSS ingest can pass `catalogNames: false` so Firehose does not scan the
 * full listings name list on every headline.
 */

export const MEGA_CAP_TICKERS = new Set([
  "AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "NVDA", "META", "TSLA", "JPM", "JNJ", "UNH",
  "PG", "XOM", "CVX", "HD", "BAC", "V", "MA", "PFE", "KO", "PEP", "ABBV", "MRK",
  "LLY", "COST", "AVGO", "CRM", "NFLX", "AMD", "INTC", "QCOM", "IBM", "GS", "MS",
  "WFC", "C", "DIS", "PYPL", "SQ", "COIN", "PLTR", "SNOW", "CRWD",
]);

export const CRYPTO_CASHTAGS = new Set([
  "BTC", "ETH", "SOL", "XRP", "BNB", "DOGE", "ADA", "AVAX", "LINK", "DOT",
  "LTC", "UNI", "ATOM", "NEAR", "APT", "SUI", "TON", "SHIB",
]);

/** Bare / parenthetical tokens that look like tickers but are English or macro jargon. */
const STOP_SYMBOLS = new Set([
  "A", "I", "AM", "AN", "AND", "ARE", "AS", "AT", "BE", "BUT", "BY", "CEO", "CFO", "CIO",
  "COO", "CPI", "CTO", "DD", "DNA", "EPS", "ETF", "ETN", "ETP", "EV", "FED", "FOR",
  "FOMC", "GDP", "GO", "HR", "IF", "IMF", "IN", "IPO", "IRS", "IS", "IT", "ITS",
  "LLC", "LP", "MVP", "NAV", "NOW", "NYSE", "OF", "ON", "OR", "OTC", "OUR", "OUT",
  "PE", "PM", "PMI", "PPI", "PR", "QOQ", "SEC", "SO", "THE", "TO", "TV", "US", "USA",
  "USD", "VS", "WE", "WHO", "YOY",
]);

const NAME_STOP = new Set([
  "AMERICAN", "COMPANY", "CORPORATION", "ENERGY", "FINANCIAL", "FIRST", "GLOBAL",
  "GROUP", "HOLDINGS", "INC", "INTERNATIONAL", "LIMITED", "NATIONAL", "NEW",
  "TECHNOLOGY", "THE", "UNITED",
]);

const LISTING_TAIL_RE = /\s+-\s+.*$/;
const LISTING_SHARE_CLASS_RE = /\b(?:COMMON STOCK|ORDINARY SHARES|CLASS [A-Z]|WARRANT|RIGHTS?|UNITS?)\b/g;
const LISTING_SUFFIX_RE = /\b(?:INCORPORATED|CORPORATION|COMPANY|LIMITED|HOLDINGS|GROUP|INC|CORP|LTD|PLC|LLC|LP|SA|AG|NV|CO)\b\.?/g;

const CASHTAG_RE = /\$([A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)*)\b/g;
const EXCHANGE_PREFIX_RE = /\b(?:NASDAQ|NYSE|AMEX|NYSEARCA|ARCA|OTC|BATS|CBOE|TSX|LSE|HKEX):([A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)*)\b/g;
const PAREN_RE = /\(([A-Z]{1,5}(?:[.-][A-Z0-9]+)?)\)/g;
const BARE_TOKEN_RE = /\b[A-Z]{1,5}\b/g;

export interface ArticleTickerName {
  name: string;
  symbol: string;
}

export interface ArticleTickerUniverse {
  /** Mega-caps + user book. Used for bare tokens. */
  bookSymbols: Set<string>;
  /** Book + catalog + crypto. Used for dotted/hyphen cashtags. */
  catalogSymbols: Set<string>;
  /** Longest-first company names from watchlist + catalog. */
  names: ArticleTickerName[];
}

export interface TickerUniverseInput {
  symbol: string;
  name?: string | null;
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function symbolAliases(symbol: string): string[] {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return [];
  const aliases = new Set<string>([normalized]);
  aliases.add(normalized.replace(/[./]/g, "-"));
  aliases.add(normalized.replace(/[-/]/g, "."));
  aliases.add(normalized.replace(/[.-]/g, "/"));
  aliases.add(normalized.replace(/-USD$/, ""));
  if (CRYPTO_CASHTAGS.has(normalized) || CRYPTO_CASHTAGS.has(normalized.replace(/-USD$/, ""))) {
    aliases.add(`${normalized.replace(/-USD$/, "")}-USD`);
  }
  return [...aliases];
}

function catalogHas(symbol: string, catalog: Set<string>): boolean {
  for (const alias of symbolAliases(symbol)) {
    if (catalog.has(alias)) return true;
  }
  return false;
}

export function normalizeCompanyName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let name = raw.toUpperCase().replace(LISTING_TAIL_RE, "");
  name = name.replace(LISTING_SHARE_CLASS_RE, " ");
  name = name.replace(LISTING_SUFFIX_RE, " ");
  name = name.replace(/[^A-Z0-9]+/g, " ").trim();
  if (name.length < 4) return null;
  if (NAME_STOP.has(name) || STOP_SYMBOLS.has(name)) return null;
  return name;
}

const MEGA_CAP_NAMES: ReadonlyArray<ArticleTickerName> = [
  { name: "APPLE", symbol: "AAPL" },
  { name: "MICROSOFT", symbol: "MSFT" },
  { name: "NVIDIA", symbol: "NVDA" },
  { name: "AMAZON", symbol: "AMZN" },
  { name: "ALPHABET", symbol: "GOOGL" },
  { name: "GOOGLE", symbol: "GOOGL" },
  { name: "META PLATFORMS", symbol: "META" },
  { name: "FACEBOOK", symbol: "META" },
  { name: "TESLA", symbol: "TSLA" },
  { name: "NETFLIX", symbol: "NFLX" },
  { name: "INTEL", symbol: "INTC" },
  { name: "ADVANCED MICRO DEVICES", symbol: "AMD" },
  { name: "BERKSHIRE HATHAWAY", symbol: "BRK.B" },
  { name: "BITCOIN", symbol: "BTC" },
  { name: "ETHEREUM", symbol: "ETH" },
  { name: "SOLANA", symbol: "SOL" },
];

function addSymbols(target: Set<string>, symbol: string): void {
  for (const alias of symbolAliases(symbol)) {
    if (alias && !STOP_SYMBOLS.has(alias)) target.add(alias);
  }
}

export function buildArticleTickerUniverse(options: {
  book?: Iterable<TickerUniverseInput | string>;
  catalog?: Iterable<TickerUniverseInput | string>;
  /** When false, catalog symbols still validate cashtags but names are skipped. */
  catalogNames?: boolean;
} = {}): ArticleTickerUniverse {
  const bookSymbols = new Set<string>();
  const catalogSymbols = new Set<string>();
  const nameMap = new Map<string, string>();

  for (const ticker of MEGA_CAP_TICKERS) addSymbols(bookSymbols, ticker);
  for (const ticker of CRYPTO_CASHTAGS) addSymbols(catalogSymbols, ticker);

  const ingest = (
    items: Iterable<TickerUniverseInput | string> | undefined,
    intoBook: boolean,
    takeNames: boolean,
  ) => {
    if (!items) return;
    for (const item of items) {
      const symbol = normalizeSymbol(typeof item === "string" ? item : item.symbol);
      if (!symbol) continue;
      if (intoBook) addSymbols(bookSymbols, symbol);
      addSymbols(catalogSymbols, symbol);
      if (!takeNames) continue;
      const name = normalizeCompanyName(typeof item === "string" ? null : item.name);
      if (name && !nameMap.has(name)) nameMap.set(name, symbol);
    }
  };

  ingest(options.book, true, true);
  ingest(options.catalog, false, options.catalogNames !== false);

  for (const ticker of MEGA_CAP_TICKERS) addSymbols(catalogSymbols, ticker);
  for (const symbol of bookSymbols) addSymbols(catalogSymbols, symbol);

  for (const entry of MEGA_CAP_NAMES) {
    if (!nameMap.has(entry.name)) nameMap.set(entry.name, entry.symbol);
  }

  const names = [...nameMap.entries()]
    .map(([name, symbol]) => ({ name, symbol }))
    .sort((left, right) => right.name.length - left.name.length || left.name.localeCompare(right.name));

  return { bookSymbols, catalogSymbols, names };
}

const DEFAULT_UNIVERSE = buildArticleTickerUniverse();
let sharedUniverse: ArticleTickerUniverse = DEFAULT_UNIVERSE;

export function setSharedArticleTickerUniverse(universe: ArticleTickerUniverse | null): void {
  sharedUniverse = universe ?? DEFAULT_UNIVERSE;
}

export function getSharedArticleTickerUniverse(): ArticleTickerUniverse {
  return sharedUniverse;
}

function isStopSymbol(symbol: string): boolean {
  return STOP_SYMBOLS.has(symbol);
}

function isDottedOrHyphen(symbol: string): boolean {
  return /[.-]/.test(symbol);
}

function acceptCashtag(symbol: string, universe: ArticleTickerUniverse): boolean {
  if (isStopSymbol(symbol)) return false;
  if (CRYPTO_CASHTAGS.has(symbol) || MEGA_CAP_TICKERS.has(symbol)) return true;
  if (isDottedOrHyphen(symbol)) return catalogHas(symbol, universe.catalogSymbols);
  return true;
}

function acceptTrustedSymbol(symbol: string): boolean {
  return !isStopSymbol(symbol) && /^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)*$/.test(symbol);
}

function pushUnique(result: string[], seen: Set<string>, symbol: string): void {
  const normalized = normalizeSymbol(symbol);
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  result.push(normalized);
}

function matchCompanyNames(
  text: string,
  universe: ArticleTickerUniverse,
  result: string[],
  seen: Set<string>,
): void {
  if (universe.names.length === 0) return;
  const haystack = ` ${text.toUpperCase().replace(/[^A-Z0-9]+/g, " ")} `;
  for (const entry of universe.names) {
    if (seen.has(entry.symbol)) continue;
    if (!haystack.includes(` ${entry.name} `)) continue;
    pushUnique(result, seen, entry.symbol);
  }
}

export function extractArticleTickers(
  text: string,
  universe: ArticleTickerUniverse = getSharedArticleTickerUniverse(),
): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const result: string[] = [];

  CASHTAG_RE.lastIndex = 0;
  for (const match of text.matchAll(CASHTAG_RE)) {
    const symbol = match[1]!;
    if (acceptCashtag(symbol, universe)) pushUnique(result, seen, symbol);
  }

  EXCHANGE_PREFIX_RE.lastIndex = 0;
  for (const match of text.matchAll(EXCHANGE_PREFIX_RE)) {
    const symbol = match[1]!;
    if (acceptTrustedSymbol(symbol)) pushUnique(result, seen, symbol);
  }

  PAREN_RE.lastIndex = 0;
  for (const match of text.matchAll(PAREN_RE)) {
    const symbol = match[1]!;
    if (!acceptTrustedSymbol(symbol)) continue;
    if (isDottedOrHyphen(symbol) && !catalogHas(symbol, universe.catalogSymbols) && !MEGA_CAP_TICKERS.has(symbol)) {
      continue;
    }
    pushUnique(result, seen, symbol);
  }

  BARE_TOKEN_RE.lastIndex = 0;
  for (const match of text.matchAll(BARE_TOKEN_RE)) {
    const symbol = match[0]!;
    if (isStopSymbol(symbol)) continue;
    if (universe.bookSymbols.has(symbol) || MEGA_CAP_TICKERS.has(symbol)) {
      pushUnique(result, seen, symbol);
    }
  }

  matchCompanyNames(text, universe, result, seen);
  return result;
}

export function extractArticleTickersFromParts(
  parts: readonly (string | null | undefined)[],
  universe?: ArticleTickerUniverse,
): string[] {
  return extractArticleTickers(parts.filter(Boolean).join("\n"), universe);
}
