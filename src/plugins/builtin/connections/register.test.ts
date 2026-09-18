import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createDefaultConfig } from "../../../types/config";
import { adjacentPlugin } from "../adjacent";
import { aiPlugin } from "../ai";
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
import {
  createInitialConnectionState,
  recordRequest,
} from "./types";

describe("connection source registry", () => {
  const disposers: Array<() => void> = [];

  // Buffered reports are process-wide, so traffic from any other module loaded
  // in this test process would otherwise replay into the reporter under test.
  beforeEach(() => {
    clearPendingConnectionReports();
  });

  afterEach(() => {
    setConnectionRequestReporter(null);
    clearPendingConnectionReports();
    while (disposers.length > 0) disposers.pop()?.();
  });

  test("lists registered first-party APIs and reports request outcomes", () => {
    const dispose = registerConnectionSource({
      id: "example-api",
      name: "Example API",
      kind: "api",
      pluginId: "example",
    });
    disposers.push(dispose);
    expect(listConnectionSources().some((source) => source.id === "example-api")).toBe(true);

    const reports: Array<{ id: string; ok: boolean }> = [];
    setConnectionRequestReporter((id, report) => {
      reports.push({ id, ok: report.success });
    });
    reportConnectionRequest("example-api", { success: true, durationMs: 12, operation: "polls" });
    expect(reports).toEqual([{ id: "example-api", ok: true }]);

    dispose();
    expect(listConnectionSources().some((source) => source.id === "example-api")).toBe(false);
  });

  test("buffers reports until a reporter attaches", () => {
    const dispose = registerConnectionSource({
      id: "rss",
      name: "RSS Feeds",
      kind: "news",
      pluginId: "news",
    });
    disposers.push(dispose);

    reportConnectionRequest("rss", { success: true, durationMs: 40, operation: "Reuters" });
    reportConnectionRequest("rss", { success: false, durationMs: 12, operation: "Bloomberg", error: "timeout" });

    const reports: Array<{ id: string; ok: boolean; operation?: string }> = [];
    setConnectionRequestReporter((id, report) => {
      reports.push({ id, ok: report.success, operation: report.operation });
    });

    expect(reports).toEqual([
      { id: "rss", ok: true, operation: "Reuters" },
      { id: "rss", ok: false, operation: "Bloomberg" },
    ]);
  });

  test("persists authRequired on the source definition", () => {
    const dispose = registerConnectionSource({
      id: "test-public",
      name: "Test Public",
      kind: "api",
      pluginId: "test",
      authRequired: false,
    });
    disposers.push(dispose);

    const source = listConnectionSources().find((s) => s.id === "test-public");
    expect(source?.authRequired).toBe(false);
  });

  test("does not list Adjacent Cloud children as their own sources", () => {
    const cloud = registerConnectionSource({
      id: ADJACENT_CLOUD_CONNECTION_ID,
      name: "Adjacent Cloud",
      kind: "data",
      pluginId: "adjacent",
      authRequired: false,
    });
    disposers.push(cloud);
    for (const id of ADJACENT_CLOUD_PROVIDER_IDS) {
      disposers.push(registerConnectionSource({
        id,
        name: id,
        kind: "data",
        pluginId: "adjacent",
      }));
    }

    const ids = listConnectionSources().map((source) => source.id);
    expect(ids).toContain(ADJACENT_CLOUD_CONNECTION_ID);
    expect(ids.filter((id) => id === ADJACENT_CLOUD_CONNECTION_ID)).toHaveLength(1);
    for (const id of ADJACENT_CLOUD_PROVIDER_IDS) {
      expect(ids).not.toContain(id);
    }
  });

  test("reports VoteHub / OWID / llm-stats / FR / OFAC / USA traffic on Adjacent Cloud", () => {
    disposers.push(registerConnectionSource({
      id: ADJACENT_CLOUD_CONNECTION_ID,
      name: "Adjacent Cloud",
      kind: "data",
      pluginId: "adjacent",
    }));

    const reports: Array<{ id: string; operation?: string }> = [];
    setConnectionRequestReporter((id, report) => {
      reports.push({ id, operation: report.operation });
    });
    reportConnectionRequest("votehub", { success: true, durationMs: 11, operation: "polls" });
    reportConnectionRequest("owid", { success: true, durationMs: 22, operation: "chart" });
    reportConnectionRequest("llm-stats", { success: true, durationMs: 8, operation: "stats" });
    reportConnectionRequest("twc-kalshi", { success: true, durationMs: 9, operation: "climate-primary" });
    reportConnectionRequest("federal-register", { success: true, durationMs: 7, operation: "fetch" });
    reportConnectionRequest("ofac-sanctions", { success: true, durationMs: 6, operation: "fetch" });
    reportConnectionRequest("usaspending", { success: true, durationMs: 5, operation: "fetch" });
    reportConnectionRequest("yahoo", { success: true, durationMs: 5, operation: "fetch" });

    expect(reports).toEqual([
      { id: ADJACENT_CLOUD_CONNECTION_ID, operation: "polls" },
      { id: ADJACENT_CLOUD_CONNECTION_ID, operation: "chart" },
      { id: ADJACENT_CLOUD_CONNECTION_ID, operation: "stats" },
      { id: ADJACENT_CLOUD_CONNECTION_ID, operation: "climate-primary" },
      { id: ADJACENT_CLOUD_CONNECTION_ID, operation: "fetch" },
      { id: ADJACENT_CLOUD_CONNECTION_ID, operation: "fetch" },
      { id: ADJACENT_CLOUD_CONNECTION_ID, operation: "fetch" },
      { id: "yahoo", operation: "fetch" },
    ]);
  });

  test("reports leftover Yahoo fragment traffic on the Yahoo origin", () => {
    disposers.push(registerConnectionSource({
      id: "yahoo",
      name: "Yahoo Finance",
      kind: "asset-data",
      pluginId: "yahoo",
    }));

    const reports: Array<{ id: string; operation?: string }> = [];
    setConnectionRequestReporter((id, report) => {
      reports.push({ id, operation: report.operation });
    });
    reportConnectionRequest("yahoo-esg", { success: true, durationMs: 4, operation: "esg" });
    reportConnectionRequest("yahoo-screener", { success: true, durationMs: 6, operation: "screener" });
    reportConnectionRequest("yahoo-dividends", { success: true, durationMs: 7, operation: "dividends" });
    reportConnectionRequest("yahoo-short-interest", { success: true, durationMs: 5, operation: "short-interest" });
    reportConnectionRequest("yahoo-fundamentals", { success: true, durationMs: 8, operation: "screener" });

    expect(reports).toEqual([
      { id: "yahoo", operation: "esg" },
      { id: "yahoo", operation: "screener" },
      { id: "yahoo", operation: "dividends" },
      { id: "yahoo", operation: "short-interest" },
      { id: "yahoo", operation: "screener" },
    ]);
    expect(listConnectionSources().map((source) => source.id)).toEqual(["yahoo"]);
  });

  test("does not list Yahoo fragments or the gloom-cloud sync alias as their own sources", () => {
    disposers.push(registerConnectionSource({
      id: "yahoo",
      name: "Yahoo Finance",
      kind: "asset-data",
      pluginId: "yahoo",
    }));
    disposers.push(registerConnectionSource({
      id: "gloom-cloud-http",
      name: "Gloom Cloud HTTP",
      kind: "api",
      pluginId: "gloomberb-cloud",
    }));
    for (const id of ["yahoo-short-interest", "yahoo-dividends", "gloom-cloud"]) {
      disposers.push(registerConnectionSource({
        id,
        name: id,
        kind: "api",
        pluginId: "test",
      }));
    }

    const ids = listConnectionSources().map((source) => source.id);
    expect(ids).toEqual(["yahoo", "gloom-cloud-http"]);
  });

  test("reports leftover gloom-cloud sync traffic on gloom-cloud-http", () => {
    disposers.push(registerConnectionSource({
      id: "gloom-cloud-http",
      name: "Gloom Cloud HTTP",
      kind: "api",
      pluginId: "gloomberb-cloud",
    }));

    const reports: Array<{ id: string; operation?: string }> = [];
    setConnectionRequestReporter((id, report) => {
      reports.push({ id, operation: report.operation });
    });
    reportConnectionRequest("gloom-cloud", { success: true, durationMs: 9, operation: "pullSnapshot" });
    expect(reports).toEqual([{ id: "gloom-cloud-http", operation: "pullSnapshot" }]);
  });

  test("Adjacent Cloud plugin registers its own source without extracted plugins", async () => {
    await adjacentPlugin.setup?.({
      persistence: { getResource: () => null, setResource() {} },
      configState: { get: () => null, set: async () => {}, delete: async () => {}, keys: () => [] },
      registerCapability() {},
      registerCommand() {},
      registerCommandBarSearchProvider() {},
      registerDocumentSearchProvider: () => () => {},
      registerChartSeriesCatalog: () => () => {},
      registerByokService: () => () => {},
      getApiKey: () => undefined,
      registerAgentPromptFragment() {},
      notify() {},
      resume: { setPaneState() {} },
      focusPane() {},
    } as never);
    disposers.push(() => adjacentPlugin.dispose?.());

    const ids = listConnectionSources().map((source) => source.id);
    // VoteHub, FR, OFAC, and USAspending fold onto Adjacent Cloud. Weather is
    // a WX shortcut on the Adjacent pane, not a composed plugin with its own
    // Connections source ids.
    expect(ids).toEqual([
      ADJACENT_CLOUD_CONNECTION_ID,
    ]);
  });

  test("does not register AI providers as Connections sources", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-ai-connections");
    await aiPlugin.setup?.({
      getConfig: () => config,
      configState: {
        get: (key: string) => config.pluginConfig.ai?.[key] ?? null,
        set: async (key: string, value: unknown) => {
          config.pluginConfig.ai = { ...(config.pluginConfig.ai ?? {}), [key]: value };
        },
        delete: async () => {},
        keys: () => Object.keys(config.pluginConfig.ai ?? {}),
      },
      resume: {
        getState: () => null,
        setState() {},
        deleteState() {},
        getPaneState: () => null,
        setPaneState() {},
        deletePaneState() {},
      },
      registerPane() {},
      registerPaneTemplate() {},
      registerTickerResearchTab() {},
      registerCommand() {},
      on: () => () => {},
      log: { warn() {}, info() {} },
    } as never);
    disposers.push(() => aiPlugin.dispose?.());

    const ids = listConnectionSources().map((source) => source.id);
    for (const providerId of AI_PROVIDER_IDS) {
      expect(ids).not.toContain(`ai-${providerId}`);
    }
  });

  test("createInitialConnectionState propagates authRequired", () => {
    const state = createInitialConnectionState("x", "X", "api", "p", 100, false, false);
    expect(state.authRequired).toBe(false);
    expect(state.status).toBe("connected");
    const state2 = createInitialConnectionState("y", "Y", "api", "p", 100, false, true);
    expect(state2.authRequired).toBe(true);
    expect(state2.status).toBe("idle");
    const state3 = createInitialConnectionState("z", "Z", "api", "p", 100, false);
    expect(state3.authRequired).toBeUndefined();
    expect(state3.status).toBe("idle");
  });
});

describe("recordRequest rate limits", () => {
  test("a first 429 is reconnecting, not error", () => {
    const idle = createInitialConnectionState("kalshi", "Kalshi", "prediction-market", "pm");
    const next = recordRequest(idle, {
      success: false,
      durationMs: 40,
      operation: "fetch",
      error: "Request failed (429) for https://external-api.kalshi.com/trade-api/v2/events",
    });
    expect(next.status).toBe("reconnecting");
    expect(next.lastError).toContain("429");
  });

  test("a later 429 does not drop a live connection to error", () => {
    const idle = createInitialConnectionState("example-source", "Example", "api", "si");
    const live = recordRequest(idle, { success: true, durationMs: 80, operation: "fetch" });
    const limited = recordRequest(live, {
      success: false,
      durationMs: 20,
      operation: "fetch",
      error: "Yahoo Finance request failed (429): Too Many Requests",
    });
    expect(limited.status).toBe("connected");
  });
});
