import { describe, expect, test } from "bun:test";
import { getTvChannel } from "./channels";
import {
  buildYoutubeLiveEmbedUrl,
  extractYoutubeVideoId,
  fallbackTvStream,
  isYoutubeEmbedUrl,
  resolveHostedTvStream,
} from "./youtube-embed";

describe("youtube TV embed", () => {
  test("builds a channel live embed and a concrete video embed", () => {
    const channelUrl = buildYoutubeLiveEmbedUrl("UCIALMKvObZNtJ6AmdCLP7Lg", { muted: true });
    expect(channelUrl).toContain("youtube.com/embed/live_stream?channel=UCIALMKvObZNtJ6AmdCLP7Lg");
    expect(channelUrl).toContain("autoplay=1");
    expect(channelUrl).toContain("mute=1");
    expect(isYoutubeEmbedUrl(channelUrl)).toBe(true);

    const videoUrl = buildYoutubeLiveEmbedUrl("UCIALMKvObZNtJ6AmdCLP7Lg", {
      videoId: "abcdefghijk",
      muted: false,
    });
    expect(videoUrl).toContain("/embed/abcdefghijk?");
    expect(videoUrl).toContain("mute=0");
  });

  test("extracts video ids from watch, embed, and innertube html", () => {
    expect(extractYoutubeVideoId("https://www.youtube.com/watch?v=abcdefghijk")).toBe("abcdefghijk");
    expect(extractYoutubeVideoId("https://youtu.be/abcdefghijk")).toBe("abcdefghijk");
    expect(extractYoutubeVideoId('{"videoId":"xyzXYZ-_123"}')).toBe("xyzXYZ-_123");
  });

  test("falls back to a playable embed when YouTube HTML resolution fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("nope", { status: 503 })) as typeof fetch;
    try {
      const stream = await resolveHostedTvStream("bloomberg");
      expect(stream.sourceId).toBe("bloomberg");
      expect(stream.manifestUrl).toBe(fallbackTvStream(getTvChannel("bloomberg")).manifestUrl);
      expect(isYoutubeEmbedUrl(stream.manifestUrl)).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
