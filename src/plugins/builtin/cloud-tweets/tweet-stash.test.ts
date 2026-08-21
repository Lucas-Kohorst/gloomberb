import { describe, expect, test } from "bun:test";
import type { CloudTweetPayload } from "../../../api-client";
import { articleReaderInstanceId, TWEET_READER_PANE_ID } from "../shared/article-pop-out";
import {
  parseTweetPayload,
  serializeTweetPayload,
  tweetAuthorHandle,
} from "./tweet-stash";

function makeTweet(overrides: Partial<CloudTweetPayload> = {}): CloudTweetPayload {
  return {
    id: "123",
    url: "https://x.com/marketsbot/status/123",
    text: "Markets rally",
    createdAt: "2026-08-20T12:00:00.000Z",
    lang: "en",
    isReply: false,
    author: { id: "1", userName: "marketsbot", name: "Markets Bot" },
    metrics: {
      retweets: 0,
      replies: 0,
      likes: 0,
      quotes: 0,
      views: 0,
      bookmarks: 0,
    },
    ...overrides,
  };
}

describe("tweet pop-out stash", () => {
  test("round-trips payload JSON used as the floating reader setting", () => {
    const tweet = makeTweet({ media: [{ url: "https://pbs.twimg.com/media/photo.jpg" }] });
    const parsed = parseTweetPayload(serializeTweetPayload(tweet));
    expect(parsed?.id).toBe("123");
    expect(parsed?.text).toBe("Markets rally");
    expect(parsed?.author.userName).toBe("marketsbot");
    expect(parsed?.media?.[0]?.url).toBe("https://pbs.twimg.com/media/photo.jpg");
  });

  test("rejects incomplete payloads so a stale pane cannot crash the reader", () => {
    expect(parseTweetPayload("")).toBeNull();
    expect(parseTweetPayload("{")).toBeNull();
    expect(parseTweetPayload({ id: "123", text: "hi" })).toBeNull();
    expect(parseTweetPayload({ id: "", text: "hi", author: {}, metrics: {} })).toBeNull();
  });

  test("titles the floating pane with the author handle and a stable instance id", () => {
    expect(tweetAuthorHandle(makeTweet())).toBe("@marketsbot");
    expect(tweetAuthorHandle(makeTweet({ author: { id: "1", userName: "", name: "Desk" } }))).toBe("@Desk");
    expect(articleReaderInstanceId(TWEET_READER_PANE_ID, "abc/def")).toBe(`${TWEET_READER_PANE_ID}:abc~2Fdef`);
  });
});
