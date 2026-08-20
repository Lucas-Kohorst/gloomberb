import { setConfigStoreHost, type ConfigStoreHost } from "../../../data/config/store";
import { writeHostedUserConfig } from "../../../data/config/hosted-user-persist";
import { getHostedConfigSnapshotPusher } from "../../../data/config/hosted-config-snapshot";
import { writeHostedByokKeys } from "../../../plugins/builtin/byok/hosted-persist";
import { isPublicShareLocation } from "../../../plugins/builtin/shared/share-link";
import type { AppConfig } from "../../../types/config";
import { backendRequest, getElectrobunBackendInitSnapshot } from "./backend-rpc";

function isHostedClient(): boolean {
  return getElectrobunBackendInitSnapshot()?.desktopPlatform === "cloud";
}

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
    if (isPublicShareLocation()) return;
    if (isHostedClient()) {
      writeHostedUserConfig(config);
      writeHostedByokKeys(config);
      getHostedConfigSnapshotPusher().schedule(config);
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
