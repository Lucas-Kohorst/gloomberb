import {
  setConfigStoreHost,
  type ConfigStoreHost,
} from "../../data/config/store";
import { createDefaultConfig, type AppConfig } from "../../types/config";
import {
  hydrateHostedUserConfig,
  resolveHostedPersistUserId,
  writeHostedUserConfig,
} from "../../data/config/hosted-user-persist";
import { getHostedConfigSnapshotPusher } from "../../data/config/hosted-config-snapshot";
import { clearHostedBrowserWorkspace } from "../../data/config/hosted-file-ops";
import {
  hydrateHostedByokConfig,
  writeHostedByokKeys,
} from "../../plugins/builtin/byok/hosted-persist";

export const BROWSER_DATA_DIR = "browser://local";

function browserReady(config: AppConfig): AppConfig {
  return { ...config, onboardingComplete: true, onboardingProgress: undefined };
}

function createBrowserDefaultConfig(dataDir: string): AppConfig {
  return browserReady(createDefaultConfig(dataDir));
}

export function createBrowserConfigStore(): ConfigStoreHost {
  return {
    async getDataDir() { return BROWSER_DATA_DIR; },
    async loadConfig(dataDir) {
      const config = createBrowserDefaultConfig(dataDir);
      hydrateHostedUserConfig(config);
      hydrateHostedByokConfig(config);
      return browserReady(config);
    },
    async saveConfig(config) {
      if (!resolveHostedPersistUserId()) return;
      const saved = browserReady({ ...config, dataDir: BROWSER_DATA_DIR });
      writeHostedUserConfig(saved);
      writeHostedByokKeys(saved);
      getHostedConfigSnapshotPusher().schedule(saved);
    },
    async initDataDir(dataDir) {
      const config = createBrowserDefaultConfig(dataDir);
      writeHostedUserConfig(config);
      return config;
    },
    async resetAllData(dataDir) {
      const pusher = getHostedConfigSnapshotPusher();
      pusher.cancel();
      clearHostedBrowserWorkspace();
      const config = createBrowserDefaultConfig(dataDir);
      writeHostedUserConfig(config);
      writeHostedByokKeys(config);
      await pusher.flushForced(config);
    },
    async exportConfig() {
      throw new Error("Config file export is unavailable in the browser.");
    },
    async importConfig() {
      throw new Error("Config file import is unavailable in the browser.");
    },
  };
}

export function installBrowserConfigStore(): void {
  setConfigStoreHost(createBrowserConfigStore());
}
