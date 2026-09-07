import type { AppTickerRepositoryPort } from "../../core/app-service-ports";
import { getHostedConfigSnapshotPusher } from "../../data/config/hosted-config-snapshot";
import { readHostedTickers, writeHostedTickers } from "../../data/config/hosted-ticker-persist";
import { resolveHostedPersistUserId } from "../../data/config/hosted-user-persist";
import type { TickerMetadata, TickerRecord } from "../../types/ticker";

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export class BrowserTickerRepository implements AppTickerRepositoryPort {
  async loadAllTickers(): Promise<TickerRecord[]> {
    return readHostedTickers();
  }

  async loadTicker(symbol: string): Promise<TickerRecord | null> {
    const wanted = normalizeSymbol(symbol);
    return readHostedTickers().find(
      (ticker) => normalizeSymbol(ticker.metadata.ticker) === wanted,
    ) ?? null;
  }

  async saveTicker(ticker: TickerRecord): Promise<void> {
    const userId = resolveHostedPersistUserId();
    if (!userId) return;
    const wanted = normalizeSymbol(ticker.metadata.ticker);
    const tickers = readHostedTickers(userId).filter(
      (entry) => normalizeSymbol(entry.metadata.ticker) !== wanted,
    );
    writeHostedTickers([...tickers, ticker], userId);
    getHostedConfigSnapshotPusher().scheduleFromLast();
  }

  async createTicker(metadata: TickerMetadata): Promise<TickerRecord> {
    const ticker = { metadata };
    await this.saveTicker(ticker);
    return ticker;
  }

  async deleteTicker(symbol: string): Promise<void> {
    const userId = resolveHostedPersistUserId();
    if (!userId) return;
    const wanted = normalizeSymbol(symbol);
    writeHostedTickers(
      readHostedTickers(userId).filter(
        (ticker) => normalizeSymbol(ticker.metadata.ticker) !== wanted,
      ),
      userId,
    );
    getHostedConfigSnapshotPusher().scheduleFromLast();
  }
}
