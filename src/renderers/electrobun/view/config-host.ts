import { setConfigStoreHost, type ConfigStoreHost } from "../../../data/config/store";
import { writeHostedUserConfig } from "../../../data/config/hosted-user-persist";
import { createHostedConfigSnapshotPusher } from "../../../data/config/hosted-config-snapshot";
import { writeHostedByokKeys } from "../../../plugins/builtin/byok/hosted-persist";
import type { AppConfig } from "../../../types/config";
import { backendRequest, getElectrobunBackendInitSnapshot } from "./backend-rpc";

function isHostedClient(): boolean {
  return getElectrobunBackendInitSnapshot()?.desktopPlatform === "cloud";
}

let hostedSnapshotPusher: ReturnType<typeof createHostedConfigSnapshotPusher> | null = null;

const electrobunConfigStoreHost: ConfigStoreHost = {
  async getDataDir() {
    return getElectrobunBackendInitSnapshot()?.config.dataDir ?? null;
  },
  async loadConfig() {
    const config = getElectrobunBackendInitSnapshot()?.config;
    if (!config) throw new Error("Electrobun backend has not initialized config.");
    return config;
  },
  async saveConfig(config: AppConfig) {
    if (isHostedClient()) {
      writeHostedUserConfig(config);
      writeHostedByokKeys(config);
      if (!hostedSnapshotPusher) hostedSnapshotPusher = createHostedConfigSnapshotPusher();
      hostedSnapshotPusher.schedule(config);
    }
    await backendRequest("config.save", { config });
  },
  async initDataDir() {
    const config = getElectrobunBackendInitSnapshot()?.config;
    if (!config) throw new Error("Electrobun backend has not initialized config.");
    return config;
  },
  async resetAllData(dataDir: string) {
    await backendRequest("config.resetAllData", { dataDir });
  },
  async exportConfig(config: AppConfig, destPath: string) {
    await backendRequest("config.export", { config, destPath });
  },
  async importConfig(dataDir: string, srcPath: string) {
    return backendRequest("config.import", { dataDir, srcPath });
  },
};

export function installElectrobunConfigStoreHost(): void {
  setConfigStoreHost(electrobunConfigStoreHost);
}
