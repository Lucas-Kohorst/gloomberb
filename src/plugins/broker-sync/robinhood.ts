import type { GloomPlugin } from "../../types/plugin";
import type { BrokerAdapter, BrokerConnectionStatus } from "../../types/broker";
import type { BrokerInstanceConfig } from "../../types/config";
import type { BrokerOrderRequest } from "../../types/trading";
import { registerConnectionSource, withConnectionRequest } from "../builtin/connections/register";
import { isRobinhoodOAuthConfigured, robinhoodConfigSchema } from "./connection";
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
    setStatus(instance.id, "connected", "OAuth · read accounts, trade Agentic");
    return snapshot;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Robinhood sync failed.";
    setStatus(instance.id, "error", message);
    throw error;
  }
}

async function withRobinhoodRuntime<T>(
  instance: BrokerInstanceConfig,
  operation: string,
  run: (module: Awaited<ReturnType<typeof loadRobinhoodNativeModule>>) => Promise<T>,
): Promise<T> {
  return withConnectionRequest(ROBINHOOD_CONNECTION_ID, operation, async () => {
    const module = await loadRobinhoodNativeModule();
    return run(module);
  });
}

export const robinhoodBroker: BrokerAdapter = {
  id: "robinhood",
  name: "Robinhood",
  configSchema: robinhoodConfigSchema(),

  async validate(instance) {
    return isRobinhoodOAuthConfigured(instance);
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
      // Native sync is unavailable in some renderers; still mark disconnected.
    }
    setStatus(instance.id, "disconnected");
  },

  getStatus(instance) {
    return statuses.get(instance.id) ?? {
      state: instance.config.oauth ? "connected" : "disconnected",
      message: instance.config.oauth
        ? "OAuth · read accounts, trade Agentic"
        : "Sign in during the first sync",
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

  async previewOrder(instance, request: BrokerOrderRequest) {
    return withRobinhoodRuntime(instance, "preview-order", (module) => {
      if (!module.robinhoodBroker.previewOrder) {
        throw new Error("Robinhood order preview is unavailable in this app.");
      }
      return module.robinhoodBroker.previewOrder(instance, request);
    });
  },

  async placeOrder(instance, request: BrokerOrderRequest) {
    return withRobinhoodRuntime(instance, "place-order", (module) => {
      if (!module.robinhoodBroker.placeOrder) {
        throw new Error("Robinhood trading is unavailable in this app.");
      }
      return module.robinhoodBroker.placeOrder(instance, request);
    });
  },

  async cancelOrder(instance, orderId: number) {
    await withRobinhoodRuntime(instance, "cancel-order", async (module) => {
      if (!module.robinhoodBroker.cancelOrder) {
        throw new Error("Robinhood cancel is unavailable in this app.");
      }
      await module.robinhoodBroker.cancelOrder(instance, orderId);
    });
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
  description: "Read every Robinhood account; trade only the Agentic account.",
  toggleable: true,
  broker: robinhoodBroker,
  paneTemplates: [
    {
      id: "robinhood-connect",
      paneId: "brokers",
      label: "Robinhood",
      description: "Sign in to Robinhood. Reads all accounts; trades the Agentic account",
      keywords: ["robinhood", "hood", "rh", "broker", "positions", "sync", "oauth", "agentic", "trade"],
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
