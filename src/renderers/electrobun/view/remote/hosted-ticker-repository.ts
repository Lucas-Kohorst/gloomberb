import type { TickerMetadata, TickerRecord } from "../../../../types/ticker";
import {
  mergeHostedTickers,
  readHostedTickers,
  writeHostedTickers,
} from "../../../../data/config/hosted-ticker-persist";
import { getHostedConfigUserId } from "../../../../data/config/hosted-user-persist";

/**
 * Hosted ticker persistence. The Worker `ticker.*` RPCs are intentional
 * no-ops (config.save is too), so watchlists must live in per-user
 * localStorage and be published through Gloom Cloud `/sync/snapshot`.
 */
export class HostedTickerRepository {
  private tickers: Map<string, TickerRecord>;

  constructor(initial?: Iterable<TickerRecord>) {
    this.tickers = this.toMap(initial ?? readHostedTickers());
  }

  reload(): void {
    this.tickers = this.toMap(readHostedTickers());
  }

  replaceAll(tickers: Iterable<TickerRecord>): void {
    this.tickers = this.toMap(tickers);
    writeHostedTickers([...this.tickers.values()]);
  }

  async loadAllTickers(): Promise<TickerRecord[]> {
    this.reload();
    return [...this.tickers.values()];
  }

  async loadTicker(symbol: string): Promise<TickerRecord | null> {
    this.reload();
    return this.tickers.get(symbol) ?? null;
  }

  async saveTicker(ticker: TickerRecord): Promise<void> {
    if (!getHostedConfigUserId()) {
      this.tickers.set(ticker.metadata.ticker, ticker);
      return;
    }
    mergeHostedTickers([ticker]);
    this.reload();
  }

  async createTicker(metadata: TickerMetadata): Promise<TickerRecord> {
    const ticker: TickerRecord = { metadata };
    await this.saveTicker(ticker);
    return ticker;
  }

  async deleteTicker(symbol: string): Promise<void> {
    this.reload();
    this.tickers.delete(symbol);
    writeHostedTickers([...this.tickers.values()]);
  }

  private toMap(tickers: Iterable<TickerRecord>): Map<string, TickerRecord> {
    return new Map([...tickers].map((ticker) => [ticker.metadata.ticker, ticker]));
  }
}
