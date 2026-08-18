import type { ResolvedLiveStream } from "../../../types/media";
import { getTvChannel, TV_CHANNELS, type TvChannel } from "./channels";

const YOUTUBE_VIDEO_ID = /(?:^|[^a-zA-Z0-9_-])([a-zA-Z0-9_-]{11})(?:[^a-zA-Z0-9_-]|$)/;

/**
 * Guards the render path: an embed URL may only ever be built from a concrete
 * video id, and callers must check before building so a bad id degrades to the
 * offline state instead of throwing mid-render.
 */
export function isValidYoutubeVideoId(videoId: string | undefined | null): videoId is string {
  return !!videoId && YOUTUBE_VIDEO_ID.test(videoId);
}

export function buildYoutubeLiveEmbedUrl(
  videoId: string,
  options?: { muted?: boolean; origin?: string; widgetReferrer?: string },
): string {
  if (!isValidYoutubeVideoId(videoId)) {
    throw new Error("A concrete YouTube video ID is required for an embed URL.");
  }
  const params = new URLSearchParams({
    autoplay: "1",
    mute: options?.muted === false ? "0" : "1",
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
    enablejsapi: "1",
  });
  if (options?.origin) {
    params.set("origin", options.origin);
    params.set("widget_referrer", options.widgetReferrer ?? options.origin);
  }
  return `https://www.youtube.com/embed/${videoId}?${params}`;
}

export function isYoutubeEmbedUrl(url: string): boolean {
  return /https?:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/embed\//.test(url);
}

export function fallbackTvStream(
  channel: TvChannel,
  options: { muted?: boolean; videoId: string; title?: string; isLive?: boolean; publishedText?: string },
): ResolvedLiveStream {
  const now = Date.now();
  return {
    provider: "youtube",
    sourceId: channel.id,
    videoId: options.videoId,
    title: options?.title?.trim() || `${channel.name} ${options.isLive === false ? "latest video" : "Live"}`,
    isLive: options.isLive ?? true,
    publishedText: options.publishedText,
    manifestUrl: buildYoutubeLiveEmbedUrl(options.videoId, {
      muted: options.muted,
    }),
    watchUrl: `https://www.youtube.com/watch?v=${options.videoId}`,
    resolvedAt: now,
    expiresAt: now + 10 * 60 * 1000,
  };
}

export function extractYoutubeVideoId(value: string): string | null {
  const fromQuery = /(?:youtube\.com\/watch\?[^#]*v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/.exec(value);
  if (fromQuery?.[1]) return fromQuery[1];
  const fromJson = /"videoId":"([a-zA-Z0-9_-]{11})"/.exec(value);
  if (fromJson?.[1]) return fromJson[1];
  return null;
}

const PUBLISHED_LABEL = /^(?:\d+\s+\w+\s+ago|Streamed\b.*|Premiered\b.*|Scheduled\b.*)$/;

/**
 * Finds the human-readable publish label (e.g. "3 days ago", "Streamed 2 weeks ago")
 * YouTube attaches to a specific video in the channel grid.
 *
 * Two markups are in the wild: the legacy `publishedTimeText.simpleText`, and the
 * current `metadataParts` list where the label sits ~1.3k characters after the id,
 * alongside the view count. Both are matched inside a window anchored on the id so
 * a neighbouring grid item can never donate its date.
 */
export function extractPublishedTextForVideo(html: string, videoId: string): string | null {
  const escaped = videoId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const legacy = new RegExp(`"videoId":"${escaped}"[\\s\\S]{0,3000}?"publishedTimeText":\\{"simpleText":"([^"]+)"`, "m");
  const legacyMatch = legacy.exec(html);
  if (legacyMatch?.[1]) return legacyMatch[1];

  const anchor = new RegExp(`"videoId":"${escaped}"`, "g");
  let occurrence: RegExpExecArray | null;
  while ((occurrence = anchor.exec(html))) {
    const window = html.slice(occurrence.index, occurrence.index + 3000);
    for (const [, content] of window.matchAll(/"content":"([^"]+)"/g)) {
      if (content && PUBLISHED_LABEL.test(content)) return content;
    }
  }
  return null;
}

function extractLiveYoutubeVideoId(value: string): string | null {
  const streamabilityLive = /"liveStreamabilityRenderer":\{"videoId":"([a-zA-Z0-9_-]{11})"/.exec(value);
  if (streamabilityLive?.[1]) return streamabilityLive[1];
  const videoDetailsLive = /"videoDetails":\{"videoId":"([a-zA-Z0-9_-]{11})"(?:(?!\}).){0,400}?"isLive":true/.exec(value);
  if (videoDetailsLive?.[1]) return videoDetailsLive[1];
  const liveMarker = /(?:BADGE_STYLE_TYPE_LIVE_NOW|"label":"LIVE")/;
  const videoBeforeLive = /"videoId":"([a-zA-Z0-9_-]{11})"[\s\S]{0,2000}?(?:BADGE_STYLE_TYPE_LIVE_NOW|"label":"LIVE")/.exec(value)?.[1];
  if (videoBeforeLive) return videoBeforeLive;
  const liveBeforeVideo = /(?:BADGE_STYLE_TYPE_LIVE_NOW|"label":"LIVE")[\s\S]{0,2000}?"videoId":"([a-zA-Z0-9_-]{11})"/.exec(value)?.[1];
  if (liveBeforeVideo) return liveBeforeVideo;
  return liveMarker.test(value) ? extractYoutubeVideoId(value) : null;
}

function isYoutubeConsentPage(response: Response, html: string): boolean {
  return response.url.includes("consent.youtube.com")
    || /(?:Before you continue to YouTube|consent\.youtube\.com)/i.test(html);
}

async function fetchYoutubePage(url: string, fetchImpl: typeof fetch): Promise<{ response: Response; html: string }> {
  const response = await fetchImpl(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cookie": "CONSENT=YES+cb.20210328-17-p0.en+FX+667",
    },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`YouTube live page is unavailable (${response.status}).`);
  }
  return { response, html: await response.text() };
}

export async function resolveYoutubeLivePage(
  channel: TvChannel,
  fetchImpl: typeof fetch = fetch,
): Promise<ResolvedLiveStream> {
  const livePage = await fetchYoutubePage(`https://www.youtube.com/channel/${channel.channelId}/live`, fetchImpl);
  if (isYoutubeConsentPage(livePage.response, livePage.html)) {
    throw new Error(`${channel.name} could not be resolved because YouTube returned a consent page.`);
  }

  const liveVideoId = extractYoutubeVideoId(livePage.response.url) ?? extractLiveYoutubeVideoId(livePage.html);
  if (liveVideoId && YOUTUBE_VIDEO_ID.test(liveVideoId)) {
    const rawTitle = /<title>([^<]+)<\/title>/i.exec(livePage.html)?.[1]?.replace(/\s+-+\s+YouTube\s*$/i, "").trim();
    return fallbackTvStream(channel, {
      videoId: liveVideoId,
      title: rawTitle && rawTitle !== "YouTube" ? rawTitle : undefined,
      isLive: true,
    });
  }

  const videosPage = await fetchYoutubePage(`https://www.youtube.com/channel/${channel.channelId}/videos`, fetchImpl);
  if (isYoutubeConsentPage(videosPage.response, videosPage.html)) {
    throw new Error(`${channel.name} could not be resolved because YouTube returned a consent page.`);
  }
  const videoId = extractYoutubeVideoId(videosPage.response.url) ?? extractYoutubeVideoId(videosPage.html);
  if (!videoId || !YOUTUBE_VIDEO_ID.test(videoId)) {
    throw new Error(`${channel.name} does not currently have a public video.`);
  }
  const publishedText = extractPublishedTextForVideo(videosPage.html, videoId);
  const rawTitle = /<title>([^<]+)<\/title>/i.exec(videosPage.html)?.[1]?.replace(/\s+-+\s+YouTube\s*$/i, "").trim();
  return fallbackTvStream(channel, {
    videoId,
    title: rawTitle && rawTitle !== "YouTube" ? rawTitle : undefined,
    isLive: false,
    publishedText: publishedText ?? undefined,
  });
}

export function resolveHostedTvStream(sourceId: string): Promise<ResolvedLiveStream> {
  const channel = TV_CHANNELS.find((item) => item.id === sourceId);
  if (!channel) throw new Error("Unknown TV channel.");
  return resolveYoutubeLivePage(getTvChannel(channel.id));
}
