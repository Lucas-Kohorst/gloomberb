import type { AppSessionSnapshot } from "../../core/state/session-persistence";
import {
  hostedPluginStateStorageKey,
  writeHostedPluginState,
} from "../../data/config/hosted-plugin-state-persist";
import {
  hostedSessionStorageKey,
  writeHostedSessionSnapshot,
} from "../../data/config/hosted-session-persist";
import {
  hostedTickerStorageKey,
  parseIncomingTickerRecords,
  writeHostedTickers,
} from "../../data/config/hosted-ticker-persist";
import {
  hostedUserConfigStorageKey,
  readLastHostedUserId,
  rememberHostedUserId,
  setHostedConfigUserId,
  writeHostedUserConfig,
} from "../../data/config/hosted-user-persist";
import { normalizeLoadedConfig } from "../../data/config/store/normalize";
import {
  hostedByokStorageKey,
  writeHostedByokKeys,
} from "../../plugins/builtin/byok/hosted-persist";
import { BYOK_API_KEYS_CONFIG_KEY, BYOK_PLUGIN_ID } from "../../plugins/builtin/byok/types";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const BROWSER_STORAGE_KEYS = {
  config: "gloomberb.web.config.v1",
  tickers: "gloomberb.web.tickers.v1",
  pluginState: "gloomberb.web.plugin-state.v1",
  session: "gloomberb.web.session.v1",
} as const;
const LEGACY_OWNER_KEY = "gloomberb.web.legacy-owner.v1";

function parseLegacyValue(storage: StorageLike, key: string): unknown {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasStoredValue(storage: StorageLike, key: string): boolean {
  try {
    return storage.getItem(key) !== null;
  } catch {
    return false;
  }
}

export function initializeBrowserPersistenceIdentity(
  storage: StorageLike,
  userId: string | null,
  dataDir: string,
): void {
  setHostedConfigUserId(userId);
  let owner = parseLegacyValue(storage, LEGACY_OWNER_KEY);
  if (!isRecord(owner)) {
    owner = { userId: readLastHostedUserId() };
    // Preserve the original ownership evidence even if a different account boots next.
    try { storage.setItem(LEGACY_OWNER_KEY, JSON.stringify(owner)); } catch { return; }
  }
  const legacyOwner = isRecord(owner) && typeof owner.userId === "string" ? owner.userId : null;
  const retire = (key: string, destination: string) => {
    if (hasStoredValue(storage, destination)) {
      try { storage.removeItem(key); } catch {}
    }
  };
  if (legacyOwner) {
    const migrationUserId = legacyOwner;
    const config = parseLegacyValue(storage, BROWSER_STORAGE_KEYS.config);
    if (isRecord(config)) {
      const loaded = normalizeLoadedConfig(config, dataDir).config;
      loaded.onboardingComplete = true;
      loaded.onboardingProgress = undefined;
      if (!hasStoredValue(storage, hostedUserConfigStorageKey(migrationUserId))) {
        writeHostedUserConfig(loaded, migrationUserId);
      }
      if (!hasStoredValue(storage, hostedByokStorageKey(migrationUserId))) {
        writeHostedByokKeys(loaded, migrationUserId);
      }
      const keys = loaded.pluginConfig[BYOK_PLUGIN_ID]?.[BYOK_API_KEYS_CONFIG_KEY];
      if (!isRecord(keys) || !Array.isArray(keys.keys) || keys.keys.length === 0
        || hasStoredValue(storage, hostedByokStorageKey(migrationUserId))) {
        retire(BROWSER_STORAGE_KEYS.config, hostedUserConfigStorageKey(migrationUserId));
      }
    }

    const tickers = parseLegacyValue(storage, BROWSER_STORAGE_KEYS.tickers);
    if (isRecord(tickers) && !hasStoredValue(storage, hostedTickerStorageKey(migrationUserId))) {
      writeHostedTickers(
        parseIncomingTickerRecords({ tickers: Object.values(tickers) }),
        migrationUserId,
      );
    }
    retire(BROWSER_STORAGE_KEYS.tickers, hostedTickerStorageKey(migrationUserId));

    const pluginState = parseLegacyValue(storage, BROWSER_STORAGE_KEYS.pluginState);
    if (isRecord(pluginState) && !hasStoredValue(storage, hostedPluginStateStorageKey(migrationUserId))) {
      writeHostedPluginState(
        Object.fromEntries(
          Object.entries(pluginState).filter(
            (entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]),
          ),
        ),
        migrationUserId,
      );
    }
    retire(BROWSER_STORAGE_KEYS.pluginState, hostedPluginStateStorageKey(migrationUserId));

    const sessions = parseLegacyValue(storage, BROWSER_STORAGE_KEYS.session);
    const appSession = isRecord(sessions) && isRecord(sessions.app)
      ? sessions.app.value
      : null;
    if (isRecord(appSession) && !hasStoredValue(storage, hostedSessionStorageKey(migrationUserId))) {
      writeHostedSessionSnapshot(appSession as unknown as AppSessionSnapshot, migrationUserId);
    }
    retire(BROWSER_STORAGE_KEYS.session, hostedSessionStorageKey(migrationUserId));
  }
  rememberHostedUserId(userId);
}
