import { describe, expect, test } from "bun:test";
import type { AdjacentClient } from "./client";
import { prefetchAdjacentIndexDetail, registerAdjacentDetailPreload } from "./detail-preload";

function clientStub(isPublic: boolean): { client: AdjacentClient; calls: string[] } {
  const calls: string[] = [];
  const client = {
    isPublic,
    requestApiKey: isPublic ? null : "ak_test",
    getIndex: async () => {
      calls.push("index");
      return {};
    },
    getIndexConstituents: async () => {
      calls.push("constituents");
      return { data: [] };
    },
    getIndexNews: async () => {
      calls.push("news");
      return { news: [] };
    },
    getIndexFilings: async () => {
      calls.push("filings");
      return { filings: [], meta: {} };
    },
    getIndexPrices: async () => {
      calls.push("prices");
      return { data: [] };
    },
  } as unknown as AdjacentClient;
  return { client, calls };
}

describe("adjacent detail preload", () => {
  test("warms constituents, news, prices, and filings for a keyed index", async () => {
    const { client, calls } = clientStub(false);
    prefetchAdjacentIndexDetail(client, "hou_nti");
    await Promise.resolve();
    expect(calls.sort()).toEqual(["constituents", "filings", "index", "news", "prices"]);
  });

  test("skips filings on the public tier, where that route does not exist", async () => {
    const { client, calls } = clientStub(true);
    prefetchAdjacentIndexDetail(client, "hou_nti");
    await Promise.resolve();
    expect(calls.sort()).toEqual(["constituents", "index", "news", "prices"]);
  });

  test("runs a preload another plugin registered, and stops after dispose", async () => {
    const seen: string[] = [];
    const dispose = registerAdjacentDetailPreload({
      id: "test-plugin",
      prefetch(_client, subject) {
        seen.push(subject.id);
      },
    });
    const { client } = clientStub(true);
    prefetchAdjacentIndexDetail(client, "hou_nti");
    expect(seen).toEqual(["hou_nti"]);
    dispose();
    prefetchAdjacentIndexDetail(client, "jac_nti");
    expect(seen).toEqual(["hou_nti"]);
  });
});
