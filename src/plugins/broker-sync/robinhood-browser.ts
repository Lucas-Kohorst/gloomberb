import type { BrokerAdapter } from "../../types/broker";
import type { BrokerInstanceConfig } from "../../types/config";
import type { BrokerOrderRequest } from "../../types/trading";
import { isRobinhoodOAuthConfigured, robinhoodConfigSchema } from "./connection";
import {
  cancelRobinhoodOrder,
  clearRobinhoodOAuth,
  loadRobinhoodPortfolio as loadPortfolio,
  placeRobinhoodOrder,
  previewRobinhoodOrder,
  takePendingRobinhoodOAuth,
  type RobinhoodAuthHost,
} from "./mcp-session";
import { openAuthorizationPopup, startBrowserOAuthCallback } from "./oauth-callback-browser";

const browserHost: RobinhoodAuthHost = {
  startCallback: startBrowserOAuthCallback,
  openAuthorizationUrl: openAuthorizationPopup,
};

export async function loadRobinhoodPortfolio(instance: BrokerInstanceConfig) {
  return loadPortfolio(instance, browserHost);
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
    clearRobinhoodOAuth(instance.id);
  },

  getPersistedConfigUpdate(instance) {
    return takePendingRobinhoodOAuth(instance.id);
  },

  async previewOrder(instance, request: BrokerOrderRequest) {
    return previewRobinhoodOrder(instance, request, browserHost);
  },

  async placeOrder(instance, request: BrokerOrderRequest) {
    return placeRobinhoodOrder(instance, request, browserHost);
  },

  async cancelOrder(instance, orderId: number) {
    await cancelRobinhoodOrder(instance, orderId, browserHost);
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
