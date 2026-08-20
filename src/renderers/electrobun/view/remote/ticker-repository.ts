import type { TickerMetadata, TickerRecord } from "../../../../types/ticker";
import { backendRequest, getElectrobunBackendInitSnapshot } from "../backend-rpc";
import { HostedTickerRepository } from "./hosted-ticker-repository";

function isHostedCloudClient(): boolean {
  try {
    return (globalThis as { __GLOOM_CLOUD_HOSTED?: boolean }).__GLOOM_CLOUD_HOSTED === true
      || getElectrobunBackendInitSnapshot()?.desktopPlatform === "cloud";
  } catch {
    return false;
  }
}

export class RemoteTickerRepository {
  private readonly hosted: HostedTickerRepository | null;

  constructor() {
    this.hosted = isHostedCloudClient() ? new HostedTickerRepository() : null;
  }

  async loadAllTickers(): Promise<TickerRecord[]> {
    if (this.hosted) return this.hosted.loadAllTickers();
    return backendRequest("ticker.loadAll");
  }

  async loadTicker(symbol: string): Promise<TickerRecord | null> {
    if (this.hosted) return this.hosted.loadTicker(symbol);
    return backendRequest("ticker.load", { symbol });
  }

  async saveTicker(ticker: TickerRecord): Promise<void> {
    if (this.hosted) {
      await this.hosted.saveTicker(ticker);
      return;
    }
    await backendRequest("ticker.save", { ticker });
  }

  async createTicker(metadata: TickerMetadata): Promise<TickerRecord> {
    const ticker: TickerRecord = { metadata };
    await this.saveTicker(ticker);
    return ticker;
  }

  async deleteTicker(symbol: string): Promise<void> {
    if (this.hosted) {
      await this.hosted.deleteTicker(symbol);
      return;
    }
    await backendRequest("ticker.delete", { symbol });
  }
}
