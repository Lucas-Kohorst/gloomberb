import { setConfigStoreHost, type ConfigStoreHost } from "../../../data/config/store";
import { writeHostedUserConfig } from "../../../data/config/hosted-user-persist";
import { getHostedConfigSnapshotPusher } from "../../../data/config/hosted-config-snapshot";
import {
  clearHostedBrowserWorkspace,
  downloadHostedConfigBackup,
  hostedConfigBackupFileName,
  parseHostedConfigBackup,
  pickHostedConfigBackupText,
  serializeHostedConfigBackup,
} from "../../../data/config/hosted-file-ops";
import { writeHostedByokKeys } from "../../../plugins/builtin/byok/hosted-persist";
import { isPublicShareLocation } from "../../../plugins/builtin/shared/share-link";
import { createDefaultConfig, type AppConfig } from "../../../types/config";
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
      // Worker config.save is a no-op. Posting the whole workspace still
      // encodeRpcValue's it on the main thread and can stall Disconnect.
      return;
    }
    await backendRequest("config.save", { config });
  },
  async initDataDir() {
    const config = getElectrobunBackendInitSnapshot()?.config;
    if (!config) throw new Error("Electrobun backend has not initialized config.");
    return config;
  },
  async resetAllData(dataDir: string) {
    if (isHostedClient()) {
      const pusher = getHostedConfigSnapshotPusher();
      pusher.cancel();
      clearHostedBrowserWorkspace();
      const next = createDefaultConfig(dataDir);
      next.onboardingComplete = true;
      writeHostedUserConfig(next);
      writeHostedByokKeys(next);
      await pusher.flushForced(next);
      return;
    }
    await backendRequest("config.resetAllData", { dataDir });
  },
  async exportConfig(config: AppConfig, destPath: string) {
    if (isHostedClient()) {
      downloadHostedConfigBackup(
        serializeHostedConfigBackup(config),
        hostedConfigBackupFileName(destPath),
      );
      return;
    }
    await backendRequest("config.export", { config, destPath });
  },
  async importConfig(dataDir: string, srcPath: string) {
    if (isHostedClient()) {
      const raw = await pickHostedConfigBackupText();
      const imported = parseHostedConfigBackup(raw, dataDir);
      writeHostedUserConfig(imported);
      writeHostedByokKeys(imported);
      getHostedConfigSnapshotPusher().schedule(imported);
      return imported;
    }
    return backendRequest("config.import", { dataDir, srcPath });
  },
};

export function installElectrobunConfigStoreHost(): void {
  setConfigStoreHost(electrobunConfigStoreHost);
}
