import { describe, expect, test } from "bun:test";
import {
  MAX_READ_TWEET_IDS,
  markTweetRead,
  normalizeTweetReadState,
  type TweetReadState,
} from "./read-state";

describe("tweet read state", () => {
  test("marks opened tweets as read with the most recent first", () => {
    const state = markTweetRead({ tweetIds: ["old"] }, "new");

    expect(state.tweetIds).toEqual(["new", "old"]);
  });

  test("deduplicates existing read tweets when reopened", () => {
    const state = markTweetRead({ tweetIds: ["a", "b", "a"] }, "b");

    expect(state.tweetIds).toEqual(["b", "a"]);
  });

  test("keeps persisted read state bounded", () => {
    const state = normalizeTweetReadState({
      tweetIds: Array.from({ length: MAX_READ_TWEET_IDS + 25 }, (_, index) => `id-${index}`),
    });

    expect(state.tweetIds).toHaveLength(MAX_READ_TWEET_IDS);
    expect(state.tweetIds[0]).toBe("id-0");
    expect(state.tweetIds.at(-1)).toBe(`id-${MAX_READ_TWEET_IDS - 1}`);
  });

  test("repairs persisted state with a missing tweet list", () => {
    const state = normalizeTweetReadState({} as TweetReadState);

    expect(state).toEqual({ tweetIds: [] });
  });
});
