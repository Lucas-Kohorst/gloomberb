import { afterEach, describe, expect, test } from "bun:test";
import {
  isHostedBackendManagedPluginStateKey,
  readHostedPluginState,
  writeHostedPluginState,
} from "./hosted-plugin-state-persist";
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

describe("hosted plugin state persist", () => {
  installMemoryStorage();

  afterEach(() => {
    setHostedConfigUserId(null);
    globalThis.localStorage?.clear();
  });

  test("persists chat read state and TWIT resume without the backend session blob", () => {
    setHostedConfigUserId("user-1");
    writeHostedPluginState({
      "gloomberb-cloud": {
        session: { sessionToken: "hosted-session", user: { id: "user-1" } },
        "channel:everyone": { lastViewedMessageId: "msg-9", draft: "" },
        "twitter-feed:twitter-feed:main": { feeds: [{ id: "a", query: "from:Reuters" }], activeFeedId: "a" },
      },
      substack: { auth: { email: "a@b.com", sid: "sid", loggedInAt: 1 } },
    });

    const stored = readHostedPluginState();
    expect(stored["gloomberb-cloud"]?.session).toBeUndefined();
    expect(stored["gloomberb-cloud"]?.["channel:everyone"]).toEqual({
      lastViewedMessageId: "msg-9",
      draft: "",
    });
    expect(stored["gloomberb-cloud"]?.["twitter-feed:twitter-feed:main"]).toEqual({
      feeds: [{ id: "a", query: "from:Reuters" }],
      activeFeedId: "a",
    });
    expect(stored.substack?.auth).toEqual({ email: "a@b.com", sid: "sid", loggedInAt: 1 });
    expect(isHostedBackendManagedPluginStateKey("gloomberb-cloud", "session")).toBe(true);
  });

  test("does not leak one user's plugin state into another account", () => {
    setHostedConfigUserId("user-1");
    writeHostedPluginState({ news: { read: ["a"] } });
    setHostedConfigUserId("user-2");
    expect(readHostedPluginState()).toEqual({});
  });
});
