import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  clearPendingConnectionReports,
  listConnectionSources,
  registerConnectionSource,
  reportConnectionRequest,
  setConnectionRequestReporter,
} from "./register";
import { createInitialConnectionState } from "./types";

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

  test("createInitialConnectionState propagates authRequired", () => {
    const state = createInitialConnectionState("x", "X", "api", "p", 100, false, false);
    expect(state.authRequired).toBe(false);
    const state2 = createInitialConnectionState("y", "Y", "api", "p", 100, false, true);
    expect(state2.authRequired).toBe(true);
    const state3 = createInitialConnectionState("z", "Z", "api", "p", 100, false);
    expect(state3.authRequired).toBeUndefined();
  });
});
