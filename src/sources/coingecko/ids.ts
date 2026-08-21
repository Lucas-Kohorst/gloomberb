import { parseOptionSymbol } from "../../utils/options";

export const COINGECKO_PROVIDER_ID = "coingecko";
export const COINGECKO_CONNECTION_ID = "coingecko";
export const COINGECKO_EXCHANGE = "CCC";

/** Common UI/Yahoo pair bases → CoinGecko coin ids. */
export const COINGECKO_BASE_IDS: Readonly<Record<string, string>> = Object.freeze({
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  XRP: "ripple",
  BNB: "binancecoin",
  DOGE: "dogecoin",
  ADA: "cardano",
  AVAX: "avalanche-2",
  LINK: "chainlink",
  DOT: "polkadot",
  LTC: "litecoin",
  UNI: "uniswap",
  ATOM: "cosmos",
  NEAR: "near",
  APT: "aptos",
  SUI: "sui",
  TON: "the-open-network",
  SHIB: "shiba-inu",
  BCH: "bitcoin-cash",
  XLM: "stellar",
  ETC: "ethereum-classic",
  FIL: "filecoin",
  ARB: "arbitrum",
  OP: "optimism",
  AAVE: "aave",
  ICP: "internet-computer",
  HBAR: "hedera-hashgraph",
  TRX: "tron",
  PEPE: "pepe",
  MATIC: "matic-network",
  POL: "polygon-ecosystem-token",
  ZEC: "zcash",
  WIF: "dogwifcoin",
  RENDER: "render-token",
  INJ: "injective-protocol",
  SEI: "sei-network",
  TIA: "celestia",
  MKR: "maker",
  LDO: "lido-dao",
  CRV: "curve-dao-token",
  APTOS: "aptos",
});

const QUOTE_CURRENCIES = ["USDT", "USDC", "USD", "EUR", "GBP", "JPY", "BTC", "ETH"] as const;
const CRYPTO_EXCHANGES = new Set(["CCC", "CRYPTO"]);

export interface CoinGeckoPair {
  id: string;
  base: string;
  vsCurrency: string;
  symbol: string;
}

export function isCryptoExchange(exchange?: string): boolean {
  const normalized = exchange?.trim().toUpperCase() ?? "";
  return CRYPTO_EXCHANGES.has(normalized);
}

export function isCryptoMarketInstrument(ticker: string, exchange?: string): boolean {
  const symbol = ticker.trim();
  if (!symbol || parseOptionSymbol(symbol)) return false;
  if (isCryptoExchange(exchange)) return true;
  return parseCryptoPair(symbol) != null;
}

export function parseCryptoPair(ticker: string): { base: string; quote: string } | null {
  const normalized = ticker.trim().toUpperCase().replace(/[/\s]+/g, "-");
  if (!normalized) return null;

  if (normalized.includes("-")) {
    const [base, quote] = normalized.split("-");
    if (!base || !quote) return null;
    if (!(QUOTE_CURRENCIES as readonly string[]).includes(quote)) return null;
    if (base === quote) return null;
    return { base, quote };
  }

  for (const quote of QUOTE_CURRENCIES) {
    if (!normalized.endsWith(quote)) continue;
    const base = normalized.slice(0, -quote.length);
    if (!base || base === quote) continue;
    if (COINGECKO_BASE_IDS[base]) return { base, quote };
  }
  return null;
}

export function resolveCoinGeckoPair(ticker: string, exchange?: string): CoinGeckoPair | null {
  const trimmed = ticker.trim();
  if (!trimmed || parseOptionSymbol(trimmed)) return null;

  const parsed = parseCryptoPair(trimmed);
  if (parsed) {
    const id = COINGECKO_BASE_IDS[parsed.base];
    if (!id) return null;
    return {
      id,
      base: parsed.base,
      vsCurrency: parsed.quote.toLowerCase(),
      symbol: `${parsed.base}-${parsed.quote}`,
    };
  }

  if (!isCryptoExchange(exchange)) return null;
  const base = trimmed.toUpperCase().replace(/[/\s]+/g, "");
  const id = COINGECKO_BASE_IDS[base];
  if (!id) return null;
  return {
    id,
    base,
    vsCurrency: "usd",
    symbol: `${base}-USD`,
  };
}
