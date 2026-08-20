import { saveConfig } from "../data/config/store";
import type { AppConfig } from "../types/config";
import { debugLog } from "../utils/debug-log";
import { measurePerfAsync } from "../utils/perf-marks";
import { isPublicShareLocation } from "../plugins/builtin/shared/share-link";
import {
  CONFIG_SAVE_DEBOUNCE_MS,
  createPersistScheduler,
} from "./persist-scheduler";

const log = debugLog.createLogger("persist");

const configSaveScheduler = createPersistScheduler<AppConfig>({
  delayMs: CONFIG_SAVE_DEBOUNCE_MS,
  save: (config) => measurePerfAsync("persist.config.save", () => saveConfig(config)),
  onError: (error) => {
    log.warn("config.save.failed", { error: error instanceof Error ? error.message : String(error) });
  },
});

export function scheduleConfigSave(config: AppConfig): void {
  if (isPublicShareLocation()) return;
  configSaveScheduler.schedule(config);
}

export async function saveConfigImmediately(config: AppConfig): Promise<void> {
  if (isPublicShareLocation()) return;
  await configSaveScheduler.saveImmediately(config);
}
