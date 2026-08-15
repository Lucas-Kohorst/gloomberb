import type { ResolvedLiveStream } from "../../../types/media";
import { getTvChannel, TV_CHANNELS, type TvChannel } from "./channels";

const YOUTUBE_VIDEO_ID = /(?:^|[^a-zA-Z0-9_-])([a-zA-Z0-9_-]{11})(?:[^a-zA-Z0-9_-]|$)/;

export function buildYoutubeLiveEmbedUrl(
  channelId: string,
  options?: { muted?: boolean; origin?: string; videoId?: string },
): string {
  const params = new URLSearchParams({
    autoplay: "1",
    mute: options?.muted === false ? "0" : "1",
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
    enablejsapi: "1",
  });
  if (options?.origin) params.set("origin", options.origin);
  if (options?.videoId) {
    return `https://www.youtube.com/embed/${options.videoId}?${params}`;
  }
  return `https://www.youtube.com/embed/live_stream?channel=${channelId}&${params}`;
}

export function isYoutubeEmbedUrl(url: string): boolean {
  return /https?:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/embed\//.test(url);
}

export function fallbackTvStream(
  channel: TvChannel,
  options?: { muted?: boolean; origin?: string; videoId?: string; title?: string },
): ResolvedLiveStream {
  const now = Date.now();
  return {
    provider: "youtube",
    sourceId: channel.id,
    videoId: options?.videoId ?? "",
    title: options?.title?.trim() || `${channel.name} Live`,
    manifestUrl: buildYoutubeLiveEmbedUrl(channel.channelId, {
      muted: options?.muted,
      origin: options?.origin,
      videoId: options?.videoId,
    }),
    watchUrl: options?.videoId
      ? `https://www.youtube.com/watch?v=${options.videoId}`
      : channel.channelUrl,
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

export async function resolveYoutubeLivePage(
  channel: TvChannel,
  fetchImpl: typeof fetch = fetch,
): Promise<ResolvedLiveStream> {
  const response = await fetchImpl(`https://www.youtube.com/channel/${channel.channelId}/live`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; GloomberbTV/1.0)",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`${channel.name} live page is unavailable (${response.status}).`);
  }
  const html = await response.text();
  const videoId = extractYoutubeVideoId(response.url) ?? extractYoutubeVideoId(html);
  if (!videoId || !YOUTUBE_VIDEO_ID.test(videoId)) {
    throw new Error(`${channel.name} does not currently have a public live stream.`);
  }
  const rawTitle = /<title>([^<]+)<\/title>/i.exec(html)?.[1]?.replace(/\s+-+\s+YouTube\s*$/i, "").trim();
  return fallbackTvStream(channel, {
    videoId,
    title: rawTitle && rawTitle !== "YouTube" ? rawTitle : undefined,
  });
}

export function resolveHostedTvStream(sourceId: string): Promise<ResolvedLiveStream> {
  const channel = TV_CHANNELS.find((item) => item.id === sourceId);
  if (!channel) throw new Error("Unknown TV channel.");
  return resolveYoutubeLivePage(getTvChannel(channel.id)).catch(() => fallbackTvStream(channel));
}
