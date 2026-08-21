import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PluginCapability, RegisteredCapability } from "../../../capabilities/types";
import type { DataProvider } from "../../../types/data-provider";
import type { GloomPluginContext } from "../../../types/plugin";
import { AI_PROVIDER_IDS } from "../ai/providers";
import {
  ADJACENT_CLOUD_CONNECTION_ID,
  ADJACENT_CLOUD_PROVIDER_IDS,
} from "./adjacent-cloud";
import {
  clearPendingConnectionReports,
  listConnectionSources,
  registerConnectionSource,
  reportConnectionRequest,
  setConnectionRequestReporter,
} from "./register";
import { ConnectionTracker } from "./tracker";

function adjacentNewsCapability(): RegisteredCapability {
  const capability: PluginCapability = {
    id: "news.adjacent",
    sourceId: "adjacent",
    kind: "news",
    name: "Adjacent News",
    operations: {},
  };
  return { capability, pluginId: "adjacent" };
}

describe("ConnectionTracker inventory", () => {
  let tracker: ConnectionTracker | null = null;
  const disposers: Array<() => void> = [];

  beforeEach(() => {
    clearPendingConnectionReports();
  });

  afterEach(() => {
    tracker?.dispose();
    tracker = null;
    setConnectionRequestReporter(null);
    clearPendingConnectionReports();
    while (disposers.length > 0) disposers.pop()?.();
  });

  function attach(capabilities: RegisteredCapability[] = []): ConnectionTracker {
    tracker = new ConnectionTracker();
    tracker.attach(
      {} as GloomPluginContext,
      () => capabilities,
      {} as DataProvider,
    );
    return tracker;
  }

  test("folds Adjacent Cloud children and Adjacent News onto one row", () => {
    disposers.push(registerConnectionSource({
      id: ADJACENT_CLOUD_CONNECTION_ID,
      name: "Adjacent Cloud",
      kind: "data",
      pluginId: "adjacent",
      authRequired: false,
    }));
    for (const id of ADJACENT_CLOUD_PROVIDER_IDS) {
      disposers.push(registerConnectionSource({
        id,
        name: id,
        kind: "data",
        pluginId: "adjacent",
      }));
    }

    const next = attach([adjacentNewsCapability()]);
    reportConnectionRequest("votehub", { success: true, durationMs: 12, operation: "polls" });
    reportConnectionRequest("owid", { success: true, durationMs: 18, operation: "chart" });
    reportConnectionRequest("us-listings", { success: true, durationMs: 9, operation: "us-listings" });

    const ids = next.getSnapshot().connections.map((row) => row.id);
    expect(ids).toContain(ADJACENT_CLOUD_CONNECTION_ID);
    expect(ids.filter((id) => id === ADJACENT_CLOUD_CONNECTION_ID)).toHaveLength(1);
    for (const id of ADJACENT_CLOUD_PROVIDER_IDS) {
      expect(ids).not.toContain(id);
    }
    expect(ids).not.toContain("news.adjacent");

    const cloud = next.getSnapshot().connections.find((row) => row.id === ADJACENT_CLOUD_CONNECTION_ID);
    expect(cloud?.name).toBe("Adjacent Cloud");
    expect(cloud?.successCount).toBe(3);
    expect(cloud?.recentRequests.map((row) => row.operation)).toEqual([
      "us-listings",
      "chart",
      "polls",
    ]);
  });

  test("does not surface AI providers as Connections rows", () => {
    const next = attach();
    for (const providerId of AI_PROVIDER_IDS) {
      reportConnectionRequest(`ai-${providerId}`, {
        success: true,
        durationMs: 4,
        operation: "run",
      });
    }

    const ids = next.getSnapshot().connections.map((row) => row.id);
    for (const providerId of AI_PROVIDER_IDS) {
      expect(ids).not.toContain(`ai-${providerId}`);
    }
    expect(listConnectionSources().some((source) => source.id.startsWith("ai-"))).toBe(false);
  });
});
