import { expect, test } from "bun:test";
import type { NewsQuery } from "../../../../../news/types";
import { newsWireModule } from "../index";
import { NEWS_INDUSTRY_CODES, NEWS_QUERY_PRESETS } from "./query-presets";

const shortcutQuery = (prefix: string): NewsQuery | undefined => {
  const template = newsWireModule.paneTemplates?.find((entry) => (
    entry.shortcut?.prefix === prefix || entry.shortcut?.aliases?.includes(prefix)
  ));
  const pane = newsWireModule.panes?.find((entry) => entry.id === template?.paneId);
  if (!pane) return undefined;
  return (pane.component as { query?: NewsQuery }).query;
};

const rssPresetQuery = (): NewsQuery | undefined => {
  for (const [key, value] of Object.entries(NEWS_QUERY_PRESETS)) {
    if (!key.toLowerCase().includes("rss")) continue;
    if (typeof value === "function") return value("sample");
    if (value && typeof value === "object") return value;
  }
  return undefined;
};

test("firehose is the combined latest feed and no other shortcut uses it", () => {
  expect(NEWS_QUERY_PRESETS.firehose).toEqual({ feed: "latest", limit: 200 });
  expect(shortcutQuery("FH")).toBe(NEWS_QUERY_PRESETS.firehose);

  expect(shortcutQuery("TOP")).toBe(NEWS_QUERY_PRESETS.top);
  expect(shortcutQuery("N")).toBe(NEWS_QUERY_PRESETS.feed);
  expect(shortcutQuery("FIRST")).toBe(NEWS_QUERY_PRESETS.breaking);
  expect(NEWS_QUERY_PRESETS.top).not.toBe(NEWS_QUERY_PRESETS.firehose);
  expect(NEWS_QUERY_PRESETS.feed).not.toBe(NEWS_QUERY_PRESETS.firehose);
  expect(NEWS_QUERY_PRESETS.breaking).not.toBe(NEWS_QUERY_PRESETS.firehose);

  expect(shortcutQuery("NI")).not.toBe(NEWS_QUERY_PRESETS.firehose);
  expect(NEWS_QUERY_PRESETS.sectorAll).not.toBe(NEWS_QUERY_PRESETS.firehose);
  for (const entry of NEWS_INDUSTRY_CODES) {
    if (entry.sector) expect(NEWS_QUERY_PRESETS.sector(entry.sector)).not.toBe(NEWS_QUERY_PRESETS.firehose);
    if (entry.topic) expect(NEWS_QUERY_PRESETS.topic(entry.topic)).not.toBe(NEWS_QUERY_PRESETS.firehose);
  }

  expect(shortcutQuery("RSS")).not.toBe(NEWS_QUERY_PRESETS.firehose);
  expect(rssPresetQuery()).not.toBe(NEWS_QUERY_PRESETS.firehose);
});
