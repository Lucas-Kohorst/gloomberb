import type { TickerMetadata, TickerRecord } from "../../../../types/ticker";
import { getHostedConfigUserId } from "../../../../data/config/hosted-user-persist";
import {
  HOSTED_GUEST_USER_ID,
  deleteHostedUserTicker,
  peekHostedUserTickerStamp,
  readHostedUserTickers,
  upsertHostedUserTicker,
} from "../../../../data/config/hosted-user-tickers";
import { scheduleHostedTickerSnapshot } from "../../../../data/config/hosted-config-snapshot";
import { backendRequest, getElectrobunBackendInitSnapshot } from "../backend-rpc";

function hostedPersistUserId(): string | null {
  return getHostedConfigUserId()
    ?? (getElectrobunBackendInitSnapshot()?.desktopPlatform === "cloud" ? HOSTED_GUEST_USER_ID : null);
}

export class RemoteTickerRepository {
  async loadAllTickers(): Promise<TickerRecord[]> {
    const userId = hostedPersistUserId();
    if (userId && peekHostedUserTickerStamp(userId)) {
      return readHostedUserTickers(userId);
    }
    return backendRequest("ticker.loadAll");
  }

  async loadTicker(symbol: string): Promise<TickerRecord | null> {
    const userId = hostedPersistUserId();
    if (userId) {
      const normalized = symbol.trim().toUpperCase();
      const local = readHostedUserTickers(userId).find(
        (entry) => entry.metadata.ticker.trim().toUpperCase() === normalized,
      );
      if (local) return local;
    }
    return backendRequest("ticker.load", { symbol });
  }

  async saveTicker(ticker: TickerRecord): Promise<void> {
    const userId = hostedPersistUserId();
    if (userId) {
      upsertHostedUserTicker(ticker, userId);
      scheduleHostedTickerSnapshot();
    }
    await backendRequest("ticker.save", { ticker });
  }

  async createTicker(metadata: TickerMetadata): Promise<TickerRecord> {
    const ticker: TickerRecord = { metadata };
    await this.saveTicker(ticker);
    return ticker;
  }

  async deleteTicker(symbol: string): Promise<void> {
    const userId = hostedPersistUserId();
    if (userId) {
      deleteHostedUserTicker(symbol, userId);
      scheduleHostedTickerSnapshot();
    }
    await backendRequest("ticker.delete", { symbol });
  }
}
