import { describe, expect, test } from "bun:test";
import {
  buildYoutubeLiveEmbedUrl,
  extractYoutubeVideoId,
  isYoutubeEmbedUrl,
  resolveHostedTvStream,
} from "./youtube-embed";

describe("youtube TV embed", () => {
  test("builds a channel fallback and a concrete video embed without an origin", () => {
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
    expect(videoUrl).not.toContain("origin=");
  });

  test("extracts video ids from watch, embed, and innertube html", () => {
    expect(extractYoutubeVideoId("https://www.youtube.com/watch?v=abcdefghijk")).toBe("abcdefghijk");
    expect(extractYoutubeVideoId("https://youtu.be/abcdefghijk")).toBe("abcdefghijk");
    expect(extractYoutubeVideoId('{"videoId":"xyzXYZ-_123"}')).toBe("xyzXYZ-_123");
  });

  test("reports an unavailable live page instead of embedding a deprecated channel URL", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("nope", { status: 503 })) as typeof fetch;
    try {
      await expect(resolveHostedTvStream("bloomberg")).rejects.toThrow("live page is unavailable (503)");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
