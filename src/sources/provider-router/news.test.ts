import { describe, expect, test } from "bun:test";
import { ProviderRouterNewsRoutes } from "./news";

function failingSource() {
  return {
    id: "cloud",
    name: "cloud",
    news: {
      fetchNews: async () => {
        throw new Error("cloud down");
      },
    },
  };
}

describe("ProviderRouterNewsRoutes", () => {
  test("throws when every ticker news source fails", async () => {
    const routes = new ProviderRouterNewsRoutes({
      newsSourcesInPriorityOrder: () => [failingSource()],
      logProviderError: () => {},
    });

    await expect(routes.getNews({ feed: "ticker", ticker: "AAPL" })).rejects.toThrow("cloud down");
  });

  test("throws when every global news source fails", async () => {
    const routes = new ProviderRouterNewsRoutes({
      newsSourcesInPriorityOrder: () => [failingSource()],
      logProviderError: () => {},
    });

    await expect(routes.getNews({ feed: "latest" })).rejects.toThrow("cloud down");
  });
});
