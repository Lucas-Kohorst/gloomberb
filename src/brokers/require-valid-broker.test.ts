import { describe, expect, test } from "bun:test";
import type { BrokerAdapter } from "../types/broker";
import type { BrokerInstanceConfig } from "../types/config";
import { requireValidBroker } from "./require-valid-broker";

function instance(): BrokerInstanceConfig {
  return {
    id: "rh-1",
    brokerType: "robinhood",
    label: "Robinhood",
    config: {},
  };
}

function adapter(overrides: Partial<BrokerAdapter>): BrokerAdapter {
  return {
    id: "demo",
    name: "Demo",
    configSchema: [],
    validate: async () => true,
    importPositions: async () => [],
    ...overrides,
  };
}

describe("requireValidBroker", () => {
  test("lets a connectable Robinhood oauth profile through", async () => {
    await requireValidBroker(adapter({
      id: "robinhood",
      name: "Robinhood",
      validate: async () => true,
    }), instance());
  });

  test("surfaces thrown validate errors instead of setup-is-incomplete", async () => {
    await expect(requireValidBroker(adapter({
      id: "robinhood",
      name: "Robinhood",
      validate: async () => {
        throw new Error("Hosted data capabilities are not available in the hosted client yet.");
      },
    }), instance())).rejects.toThrow("Hosted data capabilities are not available");
  });

  test("uses a precise Robinhood message when validate returns false", async () => {
    await expect(requireValidBroker(adapter({
      id: "robinhood",
      name: "Robinhood",
      validate: async () => false,
    }), instance())).rejects.toThrow("Robinhood sign-in is not ready");
  });

  test("keeps the incomplete message for other brokers that return false", async () => {
    await expect(requireValidBroker(adapter({
      validate: async () => false,
    }), instance())).rejects.toThrow("Demo setup is incomplete.");
  });
});
