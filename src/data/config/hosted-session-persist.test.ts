import { afterEach, describe, expect, test } from "bun:test";
import type { AppSessionSnapshot } from "../../core/state/session-persistence";
import { readHostedSessionSnapshot, writeHostedSessionSnapshot } from "./hosted-session-persist";
import { setHostedConfigUserId } from "./hosted-user-persist";

function installMemoryStorage(): void {
  const values = new Map<string, string>();
  const store = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } satisfies Storage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: store,
  });
}

const snapshot: AppSessionSnapshot = {
  paneState: {
    "chart-composer:main": { cursorSymbol: "AAPL" },
  },
  focusedPaneId: "chart-composer:main",
  activePanel: "right",
  statusBarVisible: true,
  openPaneIds: ["chart-composer:main"],
  hydrationTargets: [],
  exchangeCurrencies: ["USD"],
  savedAt: 1,
};

describe("hosted session persist", () => {
  installMemoryStorage();

  afterEach(() => {
    setHostedConfigUserId(null);
    globalThis.localStorage?.clear();
  });

  test("round-trips pane settings snapshot for the signed-in user", () => {
    setHostedConfigUserId("user-1");
    writeHostedSessionSnapshot(snapshot);
    expect(readHostedSessionSnapshot()?.focusedPaneId).toBe("chart-composer:main");
    expect(readHostedSessionSnapshot()?.paneState["chart-composer:main"]).toEqual({ cursorSymbol: "AAPL" });
  });

  test("does not leak session snapshot across accounts", () => {
    setHostedConfigUserId("user-1");
    writeHostedSessionSnapshot(snapshot);
    setHostedConfigUserId("user-2");
    expect(readHostedSessionSnapshot()).toBeNull();
  });
});
