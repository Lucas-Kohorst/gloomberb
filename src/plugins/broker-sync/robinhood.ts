import type { BrokerAdapter, BrokerConnectionStatus } from "../../types/broker";
import type { BrokerInstanceConfig } from "../../types/config";
import type { GloomPlugin } from "../../types/plugin";
import { registerConnectionSource, withConnectionRequest } from "../builtin/connections/register";
import { loadRobinhoodNativeModule } from "./native-loader";
import type { BrokerPortfolioSnapshot } from "./normalize";

const ROBINHOOD_CONNECTION_ID = "robinhood";

const statuses = new Map<string, BrokerConnectionStatus>();
const statusListeners = new Map<string, Set<() => void>>();

let disposeRobinhoodConnection: (() => void) | null = null;

function setStatus(instanceId: string, state: BrokerConnectionStatus["state"], message?: string): void {
  statuses.set(instanceId, { state, message, mode: "oauth", updatedAt: Date.now() });
  for (const listener of statusListeners.get(instanceId) ?? []) listener();
}

async function loadRobinhoodPortfolio(instance: BrokerInstanceConfig): Promise<BrokerPortfolioSnapshot> {
  setStatus(instance.id, "connecting", "Waiting for Robinhood");
  try {
    const snapshot = await withConnectionRequest(ROBINHOOD_CONNECTION_ID, "sync-portfolio", async () => {
      const module = await loadRobinhoodNativeModule();
      return module.loadRobinhoodPortfolio(instance);
    });
    setStatus(instance.id, "connected", "Read-only OAuth connection");
    return snapshot;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Robinhood sync failed.";
    setStatus(instance.id, "error", message);
    throw error;
  }
}

export const robinhoodBroker: BrokerAdapter = {
  id: "robinhood",
  name: "Robinhood",
  configSchema: [{
    key: "connectionMode",
    label: "Connection",
    type: "select",
    required: true,
    defaultValue: "oauth",
    options: [{
      label: "Robinhood sign-in (read-only sync)",
      value: "oauth",
      description: "Gloomberb opens Robinhood in your browser.",
    }],
  }],

  async validate(instance) {
    return instance.config.connectionMode === "oauth";
  },

  async importPositions(instance) {
    return (await loadRobinhoodPortfolio(instance)).positions;
  },

  async importPortfolioSnapshot(instance) {
    return loadRobinhoodPortfolio(instance);
  },

  async listAccounts(instance) {
    return (await loadRobinhoodPortfolio(instance)).accounts;
  },

  async connect(instance) {
    await loadRobinhoodPortfolio(instance);
  },

  async disconnect(instance) {
    try {
      const module = await loadRobinhoodNativeModule();
      await module.robinhoodBroker.disconnect?.(instance);
    } catch {
      // Native sync is unavailable in the web/hosted renderer.
    }
    setStatus(instance.id, "disconnected");
  },

  getStatus(instance) {
    return statuses.get(instance.id) ?? {
      state: instance.config.oauth ? "connected" : "disconnected",
      message: instance.config.oauth ? "Read-only OAuth connection" : "Sign in during the first sync",
      mode: "oauth",
      updatedAt: 0,
    };
  },

  subscribeStatus(instance, listener) {
    const listeners = statusListeners.get(instance.id) ?? new Set();
    listeners.add(listener);
    statusListeners.set(instance.id, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) statusListeners.delete(instance.id);
    };
  },

  async getPersistedConfigUpdate(instance) {
    try {
      const module = await loadRobinhoodNativeModule();
      return module.robinhoodBroker.getPersistedConfigUpdate?.(instance) ?? null;
    } catch {
      return null;
    }
  },

  toConfigValues() {
    return { connectionMode: "oauth" };
  },

  fromConfigValues(_values, previous) {
    return {
      connectionMode: "oauth",
      ...(previous?.config.oauth ? { oauth: previous.config.oauth } : {}),
    };
  },
};

export const robinhoodPlugin: GloomPlugin = {
  id: "robinhood",
  name: "Robinhood",
  version: "1.0.0",
  description: "Read-only account and position sync through Robinhood Trading MCP.",
  toggleable: true,
  broker: robinhoodBroker,
  paneTemplates: [
    {
      id: "robinhood-connect",
      paneId: "brokers",
      label: "Robinhood",
      description: "Sign in to Robinhood and sync read-only accounts and positions",
      keywords: ["robinhood", "hood", "rh", "broker", "positions", "sync", "oauth"],
      shortcut: { prefix: "RH" },
      singleton: true,
      createInstance: () => ({ placement: "floating" }),
    },
  ],
  setup() {
    disposeRobinhoodConnection = registerConnectionSource({
      id: ROBINHOOD_CONNECTION_ID,
      name: "Robinhood",
      kind: "broker",
      pluginId: "robinhood",
      priority: 400,
      authRequired: true,
    });
  },
  dispose() {
    disposeRobinhoodConnection?.();
    disposeRobinhoodConnection = null;
  },
};
