import type { AppPersistencePort } from "../../core/app-service-ports";
import type { AppSessionSnapshot } from "../../core/state/session-persistence";
import {
  readHostedPluginState,
  writeHostedPluginState,
} from "../../data/config/hosted-plugin-state-persist";
import {
  readHostedSessionSnapshot,
  writeHostedSessionSnapshot,
} from "../../data/config/hosted-session-persist";
import type { PluginStateRecord } from "../../data/plugin-state-store";
import type { SessionSnapshotRecord } from "../../data/session-store";
import { DesktopMemoryResourceStore } from "../electrobun/view/resource-store";

const SESSION_PLUGIN_ID = "browser:sessions";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function storedRecord<T>(value: unknown, schemaVersion: number): PluginStateRecord<T> | null {
  if (!isRecord(value) || value.schemaVersion !== schemaVersion || !("value" in value)) return null;
  return value as unknown as PluginStateRecord<T>;
}

export class BrowserPersistence implements AppPersistencePort {
  readonly resources = new DesktopMemoryResourceStore();

  readonly pluginState = {
    get: <T>(pluginId: string, key: string, schemaVersion = 1): PluginStateRecord<T> | null => {
      return storedRecord<T>(readHostedPluginState()[pluginId]?.[key], schemaVersion);
    },
    set: (pluginId: string, key: string, value: unknown, schemaVersion = 1): void => {
      const state = readHostedPluginState();
      writeHostedPluginState({
        ...state,
        [pluginId]: {
          ...state[pluginId],
          [key]: { value, schemaVersion, updatedAt: Date.now() },
        },
      });
    },
    delete: (pluginId: string, key: string): void => {
      const state = readHostedPluginState();
      const plugin = { ...state[pluginId] };
      delete plugin[key];
      writeHostedPluginState({ ...state, [pluginId]: plugin });
    },
    keys: (pluginId: string): string[] => Object.keys(readHostedPluginState()[pluginId] ?? {}),
    clear: (pluginId: string): void => {
      const state = { ...readHostedPluginState() };
      delete state[pluginId];
      writeHostedPluginState(state);
    },
  };

  readonly sessions = {
    get: <T>(sessionId = "app", schemaVersion = 1): SessionSnapshotRecord<T> | null => {
      if (sessionId !== "app") {
        return storedRecord<T>(
          readHostedPluginState()[SESSION_PLUGIN_ID]?.[sessionId],
          schemaVersion,
        ) as SessionSnapshotRecord<T> | null;
      }
      const snapshot = readHostedSessionSnapshot();
      if (!snapshot) return null;
      return {
        sessionId,
        value: snapshot as T,
        schemaVersion,
        updatedAt: snapshot.savedAt,
      };
    },
    set: (sessionId: string, value: unknown, schemaVersion = 1): void => {
      if (sessionId === "app") {
        writeHostedSessionSnapshot(value as AppSessionSnapshot);
        return;
      }
      this.pluginState.set(SESSION_PLUGIN_ID, sessionId, value, schemaVersion);
    },
    delete: (sessionId: string): void => {
      if (sessionId === "app") {
        writeHostedSessionSnapshot(null);
        return;
      }
      this.pluginState.delete(SESSION_PLUGIN_ID, sessionId);
    },
  };

  close(): void {}
}
