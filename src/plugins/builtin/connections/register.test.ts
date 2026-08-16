import { afterEach, describe, expect, test } from "bun:test";
import {
  listConnectionSources,
  registerConnectionSource,
  reportConnectionRequest,
  setConnectionRequestReporter,
} from "./register";

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
});
