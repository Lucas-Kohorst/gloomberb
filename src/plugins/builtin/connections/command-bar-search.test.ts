import { describe, expect, test } from "bun:test";
import { connectionSourceSearchResults, matchConnectionSources } from "./command-bar-search";
import type { ConnectionSourceDef } from "./register";

const sources: ConnectionSourceDef[] = [
  { id: "yahoo", name: "Yahoo Finance", kind: "api", pluginId: "yahoo" },
  { id: "rss", name: "RSS", kind: "news", pluginId: "news" },
  { id: "gloom-cloud-http", name: "Gloom Cloud HTTP", kind: "api", pluginId: "gloomberb-cloud" },
];

describe("Connections command-bar search", () => {
  test("finds registered sources as rows, not Assist prefixes", () => {
    expect(matchConnectionSources("yahoo", sources).map((source) => source.id)).toEqual(["yahoo"]);
    expect(matchConnectionSources("cloud http", sources).map((source) => source.id)).toEqual(["gloom-cloud-http"]);

    let opened = false;
    const rows = connectionSourceSearchResults("rss", () => {
      opened = true;
    }, sources);
    expect(rows).toEqual([expect.objectContaining({ label: "RSS", right: "CONN" })]);
    rows[0]?.execute();
    expect(opened).toBe(true);
  });
});
