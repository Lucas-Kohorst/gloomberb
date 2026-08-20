import { afterEach, describe, expect, test } from "bun:test";
import {
  listConnectionSources,
  registerConnectionSource,
  reportConnectionRequest,
  setConnectionRequestReporter,
} from "./register";
import { createInitialConnectionState, recordRequest } from "./types";

describe("connection source registry", () => {
  const disposers: Array<() => void> = [];

  afterEach(() => {
    setConnectionRequestReporter(null);
    while (disposers.length > 0) disposers.pop()?.();
  });

  test("lists registered first-party APIs and reports request outcomes", () => {
    const dispose = registerConnectionSource({
      id: "votehub",
      name: "VoteHub",
      kind: "api",
      pluginId: "polls",
    });
    disposers.push(dispose);
    expect(listConnectionSources().some((source) => source.id === "votehub")).toBe(true);

    const reports: Array<{ id: string; ok: boolean }> = [];
    setConnectionRequestReporter((id, report) => {
      reports.push({ id, ok: report.success });
    });
    reportConnectionRequest("votehub", { success: true, durationMs: 12, operation: "polls" });
    expect(reports).toEqual([{ id: "votehub", ok: true }]);

    dispose();
    expect(listConnectionSources().some((source) => source.id === "votehub")).toBe(false);
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
    const idle = createInitialConnectionState("yahoo-short-interest", "Yahoo", "api", "si");
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
