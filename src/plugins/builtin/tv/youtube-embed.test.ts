import { describe, expect, test } from "bun:test";
import {
  buildYoutubeLiveEmbedUrl,
  extractPublishedTextForVideo,
  extractYoutubeVideoId,
  resolveYoutubeLivePage,
  resolveHostedTvStream,
} from "./youtube-embed";
import { getTvChannel } from "./channels";

describe("youtube TV embed", () => {
  test("builds concrete video embeds, muted by default, with no captions", () => {
    const videoUrl = buildYoutubeLiveEmbedUrl("abcdefghijk", {
      muted: false,
      origin: "https://example.com",
    });
    expect(videoUrl).toContain("/embed/abcdefghijk?");
    expect(videoUrl).toContain("mute=0");
    expect(videoUrl).toContain("origin=https%3A%2F%2Fexample.com");
    expect(videoUrl).not.toContain("cc_load_policy");
    expect(videoUrl).not.toContain("live_stream");
    expect(() => buildYoutubeLiveEmbedUrl("")).toThrow("concrete YouTube video ID");
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

  test("reports a YouTube consent interstitial precisely", async () => {
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      url: "https://consent.youtube.com/m",
      text: async () => "<title>Before you continue to YouTube</title>",
    })) as typeof fetch;
    await expect(resolveYoutubeLivePage(getTvChannel("bloomberg"), fetchImpl))
      .rejects.toThrow("YouTube returned a consent page");
  });

  test("falls back to the latest public video when the channel is not live", async () => {
    const pages = [
      "<title>Bloomberg - YouTube</title><script>{\"videoId\":\"abcdefghijk\"}</script>",
      '<title>Bloomberg videos - YouTube</title><script>{"videoId":"zyxwvutsrqp","publishedTimeText":{"simpleText":"3 days ago"}}</script>',
    ];
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      url: "https://www.youtube.com/channel/UCIALMKvObZNtJ6AmdCLP7Lg/videos",
      text: async () => pages.shift() ?? "",
    })) as typeof fetch;
    const stream = await resolveYoutubeLivePage(getTvChannel("bloomberg"), fetchImpl);

    expect(stream.videoId).toBe("zyxwvutsrqp");
    expect(stream.isLive).toBe(false);
    expect(stream.publishedText).toBe("3 days ago");
  });

  test("extracts the publish label nearest a given video id", () => {
    const html = '{"videoId":"zyxwvutsrqp","title":"x","publishedTimeText":{"simpleText":"Premiered Aug 12, 2026"}}';
    expect(extractPublishedTextForVideo(html, "zyxwvutsrqp")).toBe("Premiered Aug 12, 2026");
    expect(extractPublishedTextForVideo(html, "abcdefghijk")).toBeNull();
  });

  test("extracts the publish label from the current metadataParts markup", () => {
    const html = '{"videoId":"zyxwvutsrqp","x":1}'
      + `,"padding":"${"-".repeat(1200)}"`
      + ',"metadataParts":[{"text":{"content":"718 views"}},{"text":{"content":"1 day ago"}}]'
      + ',{"videoId":"abcdefghijk"},"metadataParts":[{"text":{"content":"2 views"}},{"text":{"content":"5 months ago"}}]';
    expect(extractPublishedTextForVideo(html, "zyxwvutsrqp")).toBe("1 day ago");
    expect(extractPublishedTextForVideo(html, "abcdefghijk")).toBe("5 months ago");
  });
});
