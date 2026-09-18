import { describe, expect, test } from "bun:test";
import { matchTvChannels } from "./channels";
import { tvChannelSearchResults } from "./command-bar-search";

describe("TV command-bar search", () => {
  test("matches channel names and aliases without adding them as Assist prefixes", () => {
    expect(matchTvChannels("bloomberg").map((channel) => channel.id)).toEqual(["bloomberg"]);
    expect(matchTvChannels("mad money").map((channel) => channel.id)).toEqual(["kramer"]);
    expect(matchTvChannels("cnbc").map((channel) => channel.id)).toEqual(["cnbc"]);
    expect(matchTvChannels("yahoo").map((channel) => channel.id)).toEqual(["yahoo-finance"]);

    const opened: string[] = [];
    const rows = tvChannelSearchResults("cnbc", (channel) => {
      opened.push(channel.id);
    });
    expect(rows).toEqual([expect.objectContaining({ label: "CNBC", right: "TV" })]);
    rows[0]?.execute();
    expect(opened).toEqual(["cnbc"]);
  });
});
