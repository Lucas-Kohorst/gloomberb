import type { TickerMetadata, TickerRecord } from "../../../../types/ticker";
import {
  readHostedTickers,
  writeHostedTickers,
} from "../../../../data/config/hosted-ticker-persist";
import { getHostedConfigSnapshotPusher } from "../../../../data/config/hosted-config-snapshot";
import { resolveHostedPersistUserId } from "../../../../data/config/hosted-user-persist";

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
    this.hydrateFromStorage();
  }

  replaceAll(tickers: Iterable<TickerRecord>): void {
    this.tickers = this.toMap(tickers);
    this.persist();
  }

  async loadAllTickers(): Promise<TickerRecord[]> {
    this.hydrateFromStorage();
    return [...this.tickers.values()];
  }

  async loadTicker(symbol: string): Promise<TickerRecord | null> {
    this.hydrateFromStorage();
    const exact = this.tickers.get(symbol) ?? this.tickers.get(symbol.trim());
    if (exact) return exact;
    const wanted = symbol.trim().toUpperCase();
    for (const ticker of this.tickers.values()) {
      if (ticker.metadata.ticker.toUpperCase() === wanted) return ticker;
    }
    return null;
  }

  async saveTicker(ticker: TickerRecord): Promise<void> {
    this.tickers.set(ticker.metadata.ticker, ticker);
    if (resolveHostedPersistUserId()) {
      // Write the whole in-memory book. mergeHostedTickers() re-reads storage
      // first, so a user-id / quota miss would persist only this one symbol.
      this.persist();
      return;
    }
    writeHostedTickers([...this.tickers.values()]);
  }

  async createTicker(metadata: TickerMetadata): Promise<TickerRecord> {
    const ticker: TickerRecord = { metadata };
    await this.saveTicker(ticker);
    return ticker;
  }

  async deleteTicker(symbol: string): Promise<void> {
    this.hydrateFromStorage();
    this.tickers.delete(symbol);
    this.persist();
  }

  private hydrateFromStorage(): void {
    const stored = readHostedTickers();
    if (stored.length === 0) {
      if (this.tickers.size > 0) writeHostedTickers([...this.tickers.values()]);
      return;
    }
    for (const ticker of stored) {
      this.tickers.set(ticker.metadata.ticker, ticker);
    }
  }

  private persist(): void {
    writeHostedTickers([...this.tickers.values()]);
    getHostedConfigSnapshotPusher().scheduleFromLast();
  }

  private toMap(tickers: Iterable<TickerRecord>): Map<string, TickerRecord> {
    return new Map([...tickers].map((ticker) => [ticker.metadata.ticker, ticker]));
  }
}
