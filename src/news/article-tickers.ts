const MEGA_CAP_TICKERS = new Set([
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "JPM", "JNJ", "UNH",
  "PG", "XOM", "CVX", "HD", "BAC", "PFE", "KO", "PEP", "ABBV", "MRK",
  "LLY", "COST", "AVGO", "CRM", "NFLX", "AMD", "INTC", "QCOM", "IBM", "GS", "MS",
  "WFC", "DIS", "PYPL", "SQ", "COIN", "PLTR", "SNOW", "CRWD",
]);

const BARE_STOPWORDS = new Set([
  "US", "UK", "EU", "UN", "CEO", "CFO", "CTO", "COO", "GDP", "CPI", "PPI", "PMI",
  "ETF", "IPO", "AI", "API", "FOMC", "OPEC", "NATO", "ESG", "EPS", "AUM", "NAV",
  "YOY", "QOQ", "USD", "EUR", "GBP", "JPY", "CNY", "BTC", "ETH", "SEC", "FED",
  "FDA", "DOJ", "IMF", "ECB", "BOE", "BLS", "BEA", "EIA", "CBO", "NYSE", "AND",
  "THE", "FOR", "ARE", "NOT", "YOU", "ALL", "NEW", "BUT", "CAN", "WAS", "HAS",
  "NOW", "MAY", "INC", "LTD", "PLC", "CORP", "LLC",
]);

const GENERIC_NAME_TOKENS = new Set([
  "bank", "the", "group", "holdings", "corp", "inc", "ltd", "plc", "co", "company",
  "international", "global", "energy", "resources", "partners", "trust", "fund",
  "capital", "financial", "technologies", "technology", "systems", "industries",
  "services", "solutions", "networks", "media", "health", "healthcare", "national",
  "united", "american", "first", "new", "general", "limited",
]);

const DOLLAR_RE = /\$([A-Z]{1,5})\b/g;
const PAREN_RE = /\(([A-Z]{1,5})\)/g;
const EXCHANGE_RE = /\b(?:NASDAQ|NYSE|AMEX|NYSEARCA|BATS|OTC|NASDAQGS):\s*([A-Z]{1,5})\b/g;
const BARE_RE = /\b[A-Z]{2,5}\b/g;

export interface ArticleTickerName {
  symbol: string;
  name: string;
}

export interface ArticleTickerContext {
  symbols?: Iterable<string>;
  names?: Iterable<ArticleTickerName>;
}

function pushUnique(result: string[], seen: Set<string>, symbol: string, trusted = false): void {
  if (!symbol || seen.has(symbol)) return;
  if (!trusted && BARE_STOPWORDS.has(symbol)) return;
  seen.add(symbol);
  result.push(symbol);
}

function collectPattern(text: string, pattern: RegExp, result: string[], seen: Set<string>): void {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    pushUnique(result, seen, match[1]!, true);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function significantNameToken(name: string): string | null {
  const token = name.split(/\s+/)[0]?.replace(/[.,]/g, "") ?? "";
  if (token.length < 5) return null;
  if (GENERIC_NAME_TOKENS.has(token.toLowerCase())) return null;
  return token;
}

/**
 * Pull tickers out of a headline, summary, or article body.
 *
 * `$NVDA`, `(AAPL)`, and `NASDAQ:MSFT` are trusted without an allowlist.
 * Bare tokens like `AAPL` only match mega-caps or symbols the user already
 * tracks, so `CEO` / `GDP` / `THE` do not become fake tickers. Company names
 * from the user's book (`Apple Inc.`) also map onto their symbols.
 */
export function extractArticleTickers(text: string, context?: ArticleTickerContext): string[] {
  const known = new Set([
    ...MEGA_CAP_TICKERS,
    ...[...(context?.symbols ?? [])].map((symbol) => symbol.trim().toUpperCase()).filter(Boolean),
  ]);
  const result: string[] = [];
  const seen = new Set<string>();

  collectPattern(text, DOLLAR_RE, result, seen);
  collectPattern(text, PAREN_RE, result, seen);
  collectPattern(text, EXCHANGE_RE, result, seen);

  BARE_RE.lastIndex = 0;
  let bare: RegExpExecArray | null;
  while ((bare = BARE_RE.exec(text)) !== null) {
    const symbol = bare[0]!;
    if (!known.has(symbol)) continue;
    pushUnique(result, seen, symbol);
  }

  const haystack = text.toLowerCase();
  for (const entry of context?.names ?? []) {
    const symbol = entry.symbol.trim().toUpperCase();
    const name = entry.name.trim();
    if (!symbol || name.length < 4) continue;
    const escaped = escapeRegExp(name);
    if (new RegExp(`\\b${escaped}\\b`, "i").test(haystack)) {
      pushUnique(result, seen, symbol);
      continue;
    }
    const token = significantNameToken(name);
    if (token && new RegExp(`\\b${escapeRegExp(token)}\\b`, "i").test(haystack)) {
      pushUnique(result, seen, symbol);
    }
  }

  return result;
}
