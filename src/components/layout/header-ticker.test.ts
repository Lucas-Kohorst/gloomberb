import { describe, expect, test } from "bun:test";
import { createPaneInstance } from "../../types/config";
import { buildHeaderTickerSearchLaunch } from "./header-ticker";

describe("buildHeaderTickerSearchLaunch", () => {
  test("opens ticker-search with the typed symbol and no replace target on Firehose", () => {
    expect(buildHeaderTickerSearchLaunch(" nvda ", createPaneInstance("news-feed"))).toEqual({
      kind: "ticker-search",
      query: "nvda",
    });
  });

  test("retargets the focused ticker pane the same way click-title replace does", () => {
    const pane = createPaneInstance("ticker-detail", { instanceId: "ticker-research:main" });
    expect(buildHeaderTickerSearchLaunch("AAPL", pane)).toEqual({
      kind: "ticker-search",
      query: "AAPL",
      replacePaneId: "ticker-research:main",
    });
  });

  test("empty submit still opens ticker-search like backtick add-ticker", () => {
    expect(buildHeaderTickerSearchLaunch("", null)).toEqual({
      kind: "ticker-search",
      query: "",
    });
  });
});
