import { describe, expect, test } from "bun:test";
import {
  buildYoutubeLiveEmbedUrl,
  extractPublishedTextForVideo,
  extractYoutubeVideoId,
  isYoutubeEmbedUrl,
  resolveYoutubeLivePage,
  resolveHostedTvStream,
} from "./youtube-embed";
import { getTvChannel } from "./channels";

describe("youtube TV embed", () => {
  test("builds concrete video embeds with a client origin", () => {
    const videoUrl = buildYoutubeLiveEmbedUrl("abcdefghijk", {
      muted: false,
    });
    expect(videoUrl).toContain("/embed/abcdefghijk?");
    expect(videoUrl).toContain("mute=0");
    expect(videoUrl).toContain("origin=https%3A%2F%2Fterminal.kohor.st");
    expect(videoUrl).toContain("widget_referrer=https%3A%2F%2Fterminal.kohor.st");
    expect(videoUrl).not.toContain("live_stream");
    expect(() => buildYoutubeLiveEmbedUrl("")).toThrow("concrete YouTube video ID");
  });

  test("enables captions when requested", () => {
    const withCaptions = buildYoutubeLiveEmbedUrl("abcdefghijk", { captions: true });
    expect(withCaptions).toContain("cc_load_policy=1");
    expect(withCaptions).toContain("cc_lang_pref=en");
    const withoutCaptions = buildYoutubeLiveEmbedUrl("abcdefghijk", {});
    expect(withoutCaptions).not.toContain("cc_load_policy");
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

  test("resolves the stream embedded in the live player payload", async () => {
    const html = `<html><head><title>LIVE: CNBC Marathon - YouTube</title></head>
      <body><script>var ytInitialPlayerResponse={"playabilityStatus":{"status":"OK","playableInEmbed":true,
      "liveStreamability":{"liveStreamabilityRenderer":{"videoId":"9NyxcX3rhQs","pollDelayMs":"15000"}}}}
      </script></body></html>`;
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      url: "https://www.youtube.com/channel/UCvJJ_dzjViJCoLf5uKUTwoA/live",
      text: async () => html,
    })) as typeof fetch;
    const stream = await resolveYoutubeLivePage(getTvChannel("cnbc"), fetchImpl);
    expect(stream.videoId).toBe("9NyxcX3rhQs");
    expect(stream.title).toBe("LIVE: CNBC Marathon");
    expect(stream.isLive).toBe(true);
  });

  test("resolves a live stream from videoDetails marked isLive", async () => {
    const html = `<script>{"videoDetails":{"videoId":"KQp-e_XQnDE","title":"Yahoo Finance 24/7 Stream","lengthSeconds":"0","isLive":true}}</script>`;
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      url: "https://www.youtube.com/channel/UCEAZeUIeJs0IjQiqTCdVSIg/live",
      text: async () => html,
    })) as typeof fetch;
    const stream = await resolveYoutubeLivePage(getTvChannel("yahoo-finance"), fetchImpl);
    expect(stream.videoId).toBe("KQp-e_XQnDE");
  });
});
