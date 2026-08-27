import {
  createPersistScheduler,
  PLUGIN_STATE_SAVE_DEBOUNCE_MS,
  SESSION_SAVE_DEBOUNCE_MS,
} from "../../../../state/persist-scheduler";
import { backendRequest, getElectrobunBackendInitSnapshot } from "../backend-rpc";
import {
  isHostedBackendManagedPluginStateKey,
  readHostedPluginState,
  writeHostedPluginState,
} from "../../../../data/config/hosted-plugin-state-persist";
import {
  readHostedSessionSnapshot,
  writeHostedSessionSnapshot,
} from "../../../../data/config/hosted-session-persist";
import type { AppSessionSnapshot } from "../../../../core/state/session-persistence";
import { DesktopMemoryResourceStore } from "../resource-store";

const PLUGIN_STATE_BACKEND_FLUSH_DELAY_MS = 25;

class RemoteSessionStore {
  private snapshot = getElectrobunBackendInitSnapshot()?.sessionSnapshot ?? null;
  private readonly persistLocal: boolean;
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

  constructor() {
    this.persistLocal = getElectrobunBackendInitSnapshot()?.desktopPlatform === "cloud";
    if (this.persistLocal && !this.snapshot) {
      this.snapshot = readHostedSessionSnapshot();
    }
  }

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
    if (this.persistLocal && sessionId === "app") {
      writeHostedSessionSnapshot((value as AppSessionSnapshot | null) ?? null);
    }
    this.scheduler.schedule({ sessionId, value, schemaVersion });
  }

  delete(sessionId: string): void {
    if (sessionId === "app") this.snapshot = null;
    if (this.persistLocal && sessionId === "app") writeHostedSessionSnapshot(null);
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
    const snapshot = readHostedPluginState();
    for (const [pluginId, values] of Object.entries(snapshot)) {
      const entries = this.state.get(pluginId) ?? new Map<string, unknown>();
      for (const [key, value] of Object.entries(values)) {
        if (isHostedBackendManagedPluginStateKey(pluginId, key)) continue;
        entries.set(key, value);
      }
      this.state.set(pluginId, entries);
    }
  }

  private readonly localPersistScheduler = createPersistScheduler<void>({
    delayMs: PLUGIN_STATE_SAVE_DEBOUNCE_MS,
    save: () => {
      this.writeLocalStateNow();
    },
  });

  private persistLocalState(immediate = false): void {
    if (!this.persistLocal) return;
    if (immediate) {
      void this.localPersistScheduler.saveImmediately(undefined);
      return;
    }
    this.localPersistScheduler.schedule(undefined);
  }

  private writeLocalStateNow(): void {
    if (!this.persistLocal) return;
    const snapshot: Record<string, Record<string, unknown>> = {};
    for (const [pluginId, values] of this.state) {
      if (values.size === 0) continue;
      snapshot[pluginId] = Object.fromEntries(values);
    }
    writeHostedPluginState(snapshot);
  }

  get<T>(pluginId: string, key: string, schemaVersion = 1) {
    const value = this.state.get(pluginId)?.get(key);
    if (value == null) return null;
    return { value: value as T, schemaVersion, updatedAt: Date.now() };
  }

  set(pluginId: string, key: string, value: unknown, schemaVersion = 1): void {
    const current = this.state.get(pluginId)?.get(key);
    if (Object.is(current, value)) return;
    if (!this.state.has(pluginId)) this.state.set(pluginId, new Map());
    this.state.get(pluginId)!.set(key, value);
    this.getScheduler(pluginId, key).schedule({ pluginId, key, value, schemaVersion });
    this.persistLocalState();
    // Closing the window tears down the RPC before a debounced save can land.
    // Auth has to reach SQLite immediately or the next launch is signed out.
    if (key === "session" || key === "resume:session") {
      void this.flush();
    }
  }

  delete(pluginId: string, key: string): void {
    this.state.get(pluginId)?.delete(key);
    this.getScheduler(pluginId, key).cancel();
    this.pendingBackendSaves.delete(this.schedulerKey(pluginId, key));
    void this.backendSaveInFlight
      .catch(() => {})
      .then(() => backendRequest("pluginState.delete", { pluginId, key }))
      .catch(() => {});
    this.persistLocalState(true);
  }

  keys(pluginId: string): string[] {
    return [...(this.state.get(pluginId)?.keys() ?? [])];
  }

  clear(pluginId: string): void {
    this.state.delete(pluginId);
    this.persistLocalState(true);
  }

  async flush(): Promise<void> {
    await this.localPersistScheduler.flush();
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
