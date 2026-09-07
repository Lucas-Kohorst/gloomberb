import { afterEach, beforeEach, expect, test } from "bun:test";
import { ConnectionHealthRegistry } from "../../../core/connection-health";
import { bridgeRegisteredConnectionSources } from "./health-bridge";
import {
  clearPendingConnectionReports,
  registerConnectionSource,
  reportConnectionRequest,
  setConnectionRequestReporter,
} from "./register";

const disposers: Array<() => void> = [];

beforeEach(() => clearPendingConnectionReports());

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
  setConnectionRequestReporter(null);
  clearPendingConnectionReports();
});

test("mirrors registered sources and forwards request health", () => {
  const health = new ConnectionHealthRegistry();
  disposers.push(registerConnectionSource({
    id: "defillama-test",
    name: "DefiLlama",
    kind: "data",
    pluginId: "defillama",
    priority: 40,
    authRequired: false,
  }));
  reportConnectionRequest("defillama-test", {
    operation: "protocol-tvl",
    success: true,
    durationMs: 27,
  });

  const disposeBridge = bridgeRegisteredConnectionSources(health);
  disposers.push(disposeBridge);

  expect(health.getSnapshot().sources).toContainEqual(expect.objectContaining({
    id: "defillama-test",
    name: "DefiLlama",
    kind: "api",
    ownerId: "defillama",
    priority: 40,
    status: "connected",
    lastOperation: "protocol-tvl",
    lastLatencyMs: 27,
  }));

  reportConnectionRequest("defillama-test", {
    operation: "protocol-fees",
    success: false,
    durationMs: 11,
    error: "rate limited",
  });
  expect(health.getSnapshot().sources.find((source) => source.id === "defillama-test"))
    .toMatchObject({ status: "error", lastOperation: "protocol-fees", lastLatencyMs: 11 });
});

test("preserves existing core sources and removes only bridge registrations", () => {
  const health = new ConnectionHealthRegistry();
  const disposeCore = health.registerSource({
    id: "shared-source",
    name: "Core source",
    kind: "asset-data",
    ownerId: "core",
  });
  const disposeSharedLegacy = registerConnectionSource({
    id: "shared-source",
    name: "Legacy source",
    kind: "broker",
    pluginId: "legacy",
  });
  disposers.push(disposeCore, disposeSharedLegacy);

  const disposeBridge = bridgeRegisteredConnectionSources(health);
  const disposeOwnedLegacy = registerConnectionSource({
    id: "bridge-source",
    name: "Bridge source",
    kind: "prediction-market",
    pluginId: "markets",
  });
  disposers.push(disposeOwnedLegacy);

  expect(health.getSnapshot().sources.find((source) => source.id === "shared-source"))
    .toMatchObject({ name: "Core source", kind: "asset-data", ownerId: "core" });
  expect(health.hasSource("bridge-source")).toBe(true);

  disposeOwnedLegacy();
  expect(health.hasSource("bridge-source")).toBe(false);
  expect(health.hasSource("shared-source")).toBe(true);

  disposeBridge();
  expect(health.hasSource("shared-source")).toBe(true);
});
