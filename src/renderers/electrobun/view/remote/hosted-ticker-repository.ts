import type { TickerMetadata, TickerRecord } from "../../../../types/ticker";

const STORAGE_KEY = "gloomberb:hosted-tickers";

function readStoredTickers(): Map<string, TickerRecord> {
  const tickers = new Map<string, TickerRecord>();
  if (typeof window === "undefined") return tickers;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return tickers;
  }
  if (!raw) return tickers;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return tickers;
    for (const entry of parsed) {
      const ticker = (entry as TickerRecord | null)?.metadata?.ticker;
      if (typeof ticker !== "string" || !ticker.trim()) continue;
      tickers.set(ticker, entry as TickerRecord);
    }
  } catch {
    return tickers;
  }
  return tickers;
}

function writeStoredTickers(tickers: Map<string, TickerRecord>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...tickers.values()]));
  } catch {
    // Ignore quota / privacy errors; Gloom Cloud sync remains the source of truth.
  }
}

/**
 * Hosted ticker persistence. The Worker `ticker.*` RPCs are intentional
 * no-ops (config.save is too), so watchlists must live in localStorage and
 * be published through Gloom Cloud `/sync/snapshot`.
 */
export class HostedTickerRepository {
  private readonly tickers: Map<string, TickerRecord>;

  constructor(initial?: Iterable<TickerRecord>) {
    this.tickers = initial ? new Map([...initial].map((ticker) => [ticker.metadata.ticker, ticker])) : readStoredTickers();
  }

  async loadAllTickers(): Promise<TickerRecord[]> {
    return [...this.tickers.values()];
  }

  async loadTicker(symbol: string): Promise<TickerRecord | null> {
    return this.tickers.get(symbol) ?? null;
  }

  async saveTicker(ticker: TickerRecord): Promise<void> {
    this.tickers.set(ticker.metadata.ticker, ticker);
    writeStoredTickers(this.tickers);
  }

  async createTicker(metadata: TickerMetadata): Promise<TickerRecord> {
    const ticker: TickerRecord = { metadata };
    await this.saveTicker(ticker);
    return ticker;
  }

  async deleteTicker(symbol: string): Promise<void> {
    this.tickers.delete(symbol);
    writeStoredTickers(this.tickers);
  }
}
