import { describe, expect, test } from "bun:test";
import {
  buildYoutubeLiveEmbedUrl,
  extractYoutubeVideoId,
  isYoutubeEmbedUrl,
  resolveYoutubeLivePage,
  resolveHostedTvStream,
} from "./youtube-embed";
import { getTvChannel } from "./channels";

describe("youtube TV embed", () => {
  test("builds only concrete video embeds without an origin", () => {
    const videoUrl = buildYoutubeLiveEmbedUrl("abcdefghijk", {
      muted: false,
    });
    expect(videoUrl).toContain("/embed/abcdefghijk?");
    expect(videoUrl).toContain("mute=0");
    expect(videoUrl).not.toContain("origin=");
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

  test("reports offline after neither the live page nor videos feed identifies a live video", async () => {
    const pages = [
      "<title>Bloomberg - YouTube</title><script>{\"videoId\":\"abcdefghijk\"}</script>",
      "<title>Bloomberg videos - YouTube</title><script>{\"videoId\":\"zyxwvutsrqp\"}</script>",
    ];
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      url: "https://www.youtube.com/channel/UCIALMKvObZNtJ6AmdCLP7Lg/videos",
      text: async () => pages.shift() ?? "",
    })) as typeof fetch;
    await expect(resolveYoutubeLivePage(getTvChannel("bloomberg"), fetchImpl))
      .rejects.toThrow("does not currently have a public live stream");
  });
});
