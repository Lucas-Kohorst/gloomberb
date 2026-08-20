import {
  createPersistScheduler,
  PLUGIN_STATE_SAVE_DEBOUNCE_MS,
  SESSION_SAVE_DEBOUNCE_MS,
} from "../../../../state/persist-scheduler";
import { backendRequest, getElectrobunBackendInitSnapshot } from "../backend-rpc";
import { getHostedConfigUserId, readLastHostedUserId } from "../../../../data/config/hosted-user-persist";
import { DesktopMemoryResourceStore } from "../resource-store";

const PLUGIN_STATE_BACKEND_FLUSH_DELAY_MS = 25;

// On the hosted client the backend intentionally no-ops plugin state (persistence
// is owned by Gloom Cloud sync), but some plugin state — e.g. Substack auth — is
// not part of the synced config. Mirror it to per-user localStorage so it
// survives reloads without leaking across Gloom Cloud accounts.
const HOSTED_PLUGIN_STATE_STORAGE_PREFIX = "gloomberb:hosted-plugin-state:";
const LEGACY_HOSTED_PLUGIN_STATE_STORAGE_KEY = "gloomberb:hosted-plugin-state";
const BACKEND_MANAGED_PLUGIN_IDS = new Set(["gloomberb-cloud"]);

class RemoteSessionStore {
  private snapshot = getElectrobunBackendInitSnapshot()?.sessionSnapshot ?? null;
  private readonly scheduler = createPersistScheduler<{
    sessionId: string;
    value: unknown;
    schemaVersion: number;
  }>({
    delayMs: SESSION_SAVE_DEBOUNCE_MS,
    save: async ({ sessionId, value, schemaVersion }) => {
      await backendRequest("session.set", { sessionId, value, schemaVersion });
    },
  });

  get<T>(sessionId = "app", schemaVersion = 1) {
    if (sessionId !== "app" || !this.snapshot) return null;
    return {
      sessionId,
      value: this.snapshot as T,
      schemaVersion,
      updatedAt: Date.now(),
    };
  }

  set(sessionId: string, value: unknown, schemaVersion = 1): void {
    if (sessionId === "app") this.snapshot = value as typeof this.snapshot;
    this.scheduler.schedule({ sessionId, value, schemaVersion });
  }

  delete(sessionId: string): void {
    if (sessionId === "app") this.snapshot = null;
    this.scheduler.cancel();
    void backendRequest("session.delete", { sessionId }).catch(() => {});
  }

  flush(): Promise<void> {
    return this.scheduler.flush();
  }
}

interface PluginStatePersistEntry {
  pluginId: string;
  key: string;
  value: unknown;
  schemaVersion: number;
}

class RemotePluginStateStore {
  private readonly state = new Map<string, Map<string, unknown>>();
  private readonly schedulers = new Map<string, ReturnType<typeof createPersistScheduler<PluginStatePersistEntry>>>();
  private readonly pendingBackendSaves = new Map<string, PluginStatePersistEntry>();
  private backendSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private backendSaveInFlight: Promise<void> = Promise.resolve();
  private readonly persistLocal: boolean;

  constructor(initial: Record<string, Record<string, unknown>>) {
    this.persistLocal = getElectrobunBackendInitSnapshot()?.desktopPlatform === "cloud";
    for (const [pluginId, values] of Object.entries(initial)) {
      this.state.set(pluginId, new Map(Object.entries(values)));
    }
    if (this.persistLocal) this.restoreLocalState();
  }

  private restoreLocalState(): void {
    if (typeof window === "undefined") return;
    const userId = getHostedConfigUserId();
    if (!userId) return;
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(`${HOSTED_PLUGIN_STATE_STORAGE_PREFIX}${userId}`);
      if (!raw && readLastHostedUserId() === userId) {
        raw = window.localStorage.getItem(LEGACY_HOSTED_PLUGIN_STATE_STORAGE_KEY);
        if (raw) {
          window.localStorage.setItem(`${HOSTED_PLUGIN_STATE_STORAGE_PREFIX}${userId}`, raw);
          window.localStorage.removeItem(LEGACY_HOSTED_PLUGIN_STATE_STORAGE_KEY);
        }
      }
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      for (const [pluginId, values] of Object.entries(parsed as Record<string, unknown>)) {
        if (BACKEND_MANAGED_PLUGIN_IDS.has(pluginId)) continue;
        if (!values || typeof values !== "object" || Array.isArray(values)) continue;
        const entries = this.state.get(pluginId) ?? new Map<string, unknown>();
        for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
          entries.set(key, value);
        }
        this.state.set(pluginId, entries);
      }
    } catch {
      // Ignore malformed persisted state.
    }
  }

  private persistLocalState(): void {
    if (!this.persistLocal || typeof window === "undefined") return;
    const snapshot: Record<string, Record<string, unknown>> = {};
    for (const [pluginId, values] of this.state) {
      if (BACKEND_MANAGED_PLUGIN_IDS.has(pluginId) || values.size === 0) continue;
      snapshot[pluginId] = Object.fromEntries(values);
    }
    const userId = getHostedConfigUserId();
    if (!userId) return;
    try {
      window.localStorage.setItem(
        `${HOSTED_PLUGIN_STATE_STORAGE_PREFIX}${userId}`,
        JSON.stringify(snapshot),
      );
    } catch {
      // Ignore storage quota or security errors.
    }
  }

  get<T>(pluginId: string, key: string, schemaVersion = 1) {
    const value = this.state.get(pluginId)?.get(key);
    if (value == null) return null;
    return { value: value as T, schemaVersion, updatedAt: Date.now() };
  }

  set(pluginId: string, key: string, value: unknown, schemaVersion = 1): void {
    if (!this.state.has(pluginId)) this.state.set(pluginId, new Map());
    this.state.get(pluginId)!.set(key, value);
    this.getScheduler(pluginId, key).schedule({ pluginId, key, value, schemaVersion });
    this.persistLocalState();
  }

  delete(pluginId: string, key: string): void {
    this.state.get(pluginId)?.delete(key);
    this.getScheduler(pluginId, key).cancel();
    this.pendingBackendSaves.delete(this.schedulerKey(pluginId, key));
    void this.backendSaveInFlight
      .catch(() => {})
      .then(() => backendRequest("pluginState.delete", { pluginId, key }))
      .catch(() => {});
    this.persistLocalState();
  }

  keys(pluginId: string): string[] {
    return [...(this.state.get(pluginId)?.keys() ?? [])];
  }

  clear(pluginId: string): void {
    this.state.delete(pluginId);
    this.persistLocalState();
  }

  async flush(): Promise<void> {
    await Promise.all([...this.schedulers.values()].map((scheduler) => scheduler.flush()));
    await this.flushBackendSaves();
  }

  private getScheduler(pluginId: string, key: string) {
    const schedulerKey = this.schedulerKey(pluginId, key);
    let scheduler = this.schedulers.get(schedulerKey);
    if (!scheduler) {
      scheduler = createPersistScheduler({
        delayMs: PLUGIN_STATE_SAVE_DEBOUNCE_MS,
        save: (entry) => {
          this.scheduleBackendSave(entry);
        },
      });
      this.schedulers.set(schedulerKey, scheduler);
    }
    return scheduler;
  }

  private schedulerKey(pluginId: string, key: string): string {
    return `${pluginId}\u0000${key}`;
  }

  private scheduleBackendSave(entry: PluginStatePersistEntry): void {
    this.pendingBackendSaves.set(this.schedulerKey(entry.pluginId, entry.key), entry);
    if (this.backendSaveTimer) return;
    this.backendSaveTimer = setTimeout(() => {
      void this.flushBackendSaves();
    }, PLUGIN_STATE_BACKEND_FLUSH_DELAY_MS);
  }

  private async flushBackendSaves(): Promise<void> {
    if (this.backendSaveTimer) {
      clearTimeout(this.backendSaveTimer);
      this.backendSaveTimer = null;
    }
    if (this.pendingBackendSaves.size === 0) return this.backendSaveInFlight;

    const entries = [...this.pendingBackendSaves.values()];
    this.pendingBackendSaves.clear();
    const save = this.backendSaveInFlight
      .catch(() => {})
      .then(async () => {
        await backendRequest("pluginState.setMany", { entries });
      })
      .catch(() => {});
    this.backendSaveInFlight = save;
    return save;
  }
}

export class RemotePersistence {
  readonly tickers = {};
  readonly resources = new DesktopMemoryResourceStore();
  readonly pluginState = new RemotePluginStateStore(getElectrobunBackendInitSnapshot()?.pluginState ?? {});
  readonly sessions = new RemoteSessionStore();

  close(): void {
    void this.sessions.flush();
    void this.pluginState.flush();
  }
}
