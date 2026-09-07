import type { AppConfig } from "../../types/config";
import { isRecord } from "../../utils/is-record";
import { tryLocalStorage } from "../../utils/browser-storage";
import { normalizeConfigForSave, normalizeLoadedConfig } from "./store/normalize";
import { hostedUserConfigStorageKey, resolveHostedPersistUserId } from "./hosted-user-persist";
import { hostedTickerStorageKey } from "./hosted-ticker-persist";
import { hostedNotesStorageKey } from "./hosted-notes-persist";
import { hostedPluginStateStorageKey } from "./hosted-plugin-state-persist";
import { hostedSessionStorageKey } from "./hosted-session-persist";
import { hostedByokStorageKey } from "../../plugins/builtin/byok/hosted-persist";

export const HOSTED_CONFIG_BACKUP_FILENAME = "gloomberb-config-backup.json";

export class HostedConfigImportCancelledError extends Error {
  constructor() {
    super("Import cancelled.");
    this.name = "HostedConfigImportCancelledError";
  }
}

export function hostedConfigBackupFileName(destPath: string): string {
  const base = destPath.replace(/\\/g, "/").split("/").pop()?.trim();
  return base || HOSTED_CONFIG_BACKUP_FILENAME;
}

/** JSON backup without `dataDir`, matching the desktop export shape. */
export function serializeHostedConfigBackup(config: AppConfig): string {
  const persisted = normalizeConfigForSave(config);
  const { dataDir: _dataDir, ...rest } = persisted;
  return JSON.stringify(rest, null, 2);
}

export function parseHostedConfigBackup(raw: string, dataDir: string): AppConfig {
  let saved: unknown;
  try {
    saved = JSON.parse(raw);
  } catch {
    throw new Error("Config backup is not valid JSON.");
  }
  if (!isRecord(saved)) {
    throw new Error("Config backup is not a JSON object.");
  }
  return normalizeLoadedConfig(saved, dataDir).config;
}

/** Drops the selected user's hosted workspace blobs. Keeps other accounts and the remembered id. */
export function clearHostedBrowserWorkspace(userId = resolveHostedPersistUserId()): void {
  const storage = tryLocalStorage();
  if (!storage || !userId) return;
  const keys = new Set([
    hostedUserConfigStorageKey(userId),
    hostedTickerStorageKey(userId),
    hostedNotesStorageKey(userId),
    hostedPluginStateStorageKey(userId),
    hostedSessionStorageKey(userId),
    hostedByokStorageKey(userId),
  ]);
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(`gloomberb:notes:cloud://users/${userId}/`)
      || key?.startsWith(`gloomberb:notes:cloud:/users/${userId}/`)) {
      keys.add(key);
    }
  }
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      // Ignore quota or security errors.
    }
  }
}

export function downloadHostedConfigBackup(contents: string, fileName = HOSTED_CONFIG_BACKUP_FILENAME): void {
  const documentRef = globalThis.document;
  const urlApi = globalThis.URL;
  if (!documentRef || typeof urlApi?.createObjectURL !== "function") {
    throw new Error("Downloads are not available in this browser.");
  }
  const blob = new Blob([contents], { type: "application/json" });
  const href = urlApi.createObjectURL(blob);
  const link = documentRef.createElement("a");
  link.href = href;
  link.download = fileName;
  link.rel = "noopener";
  documentRef.body.appendChild(link);
  link.click();
  link.remove();
  urlApi.revokeObjectURL(href);
}

export function pickHostedConfigBackupText(): Promise<string> {
  const documentRef = globalThis.document;
  if (!documentRef) {
    return Promise.reject(new Error("File picker is not available in this browser."));
  }
  return new Promise((resolve, reject) => {
    const input = documentRef.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) {
        reject(new HostedConfigImportCancelledError());
        return;
      }
      void file.text().then(resolve, reject);
    }, { once: true });
    input.addEventListener("cancel", () => {
      input.remove();
      reject(new HostedConfigImportCancelledError());
    }, { once: true });
    input.click();
  });
}
