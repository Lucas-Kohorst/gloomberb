export const YOUTUBE_CONNECTION_ID = "youtube";

export const TV_CHANNELS = [
  {
    id: "bloomberg",
    name: "Bloomberg",
    channelId: "UCIALMKvObZNtJ6AmdCLP7Lg",
    channelUrl: "https://www.youtube.com/@markets/live",
  },
  {
    id: "cnbc",
    name: "CNBC",
    channelId: "UCvJJ_dzjViJCoLf5uKUTwoA",
    channelUrl: "https://www.youtube.com/@CNBC/live",
  },
  {
    id: "kramer",
    name: "Kramer",
    channelId: "UCrp_UI8XtuYfpiqluWLD7Lw",
    channelUrl: "https://www.youtube.com/@CNBCtelevision/live",
    parentId: "cnbc",
  },
  {
    id: "yahoo-finance",
    name: "Yahoo Finance",
    channelId: "UCEAZeUIeJs0IjQiqTCdVSIg",
    channelUrl: "https://www.youtube.com/@YahooFinance/live",
  },
  {
    id: "tbpn",
    name: "TBPN",
    channelId: "UC-DRzaGnL_vtBUpCFH5M0tg",
    channelUrl: "https://www.youtube.com/@TBPNLive/live",
  },
  {
    id: "mts",
    name: "MTS",
    channelId: "UClWkDGXEzsh77GAhs90wpXw",
    channelUrl: "https://www.youtube.com/@mtsituation/live",
  },
  {
    id: "eventual",
    name: "Eventual",
    channelId: "UCsYnqcP1cHvRVvuwAKR5s_g",
    channelUrl: "https://www.youtube.com/@Eventual-News/streams",
  },
  {
    id: "threadguy",
    name: "threadguy",
    channelId: "UCyLaBb4OibRL7KMdd4wZ0OQ",
    channelUrl: "https://www.youtube.com/@notthreadguy/streams",
  },
] as const;

export type TvChannel = (typeof TV_CHANNELS)[number];
export type TvChannelId = TvChannel["id"];

function channelParentId(channel: TvChannel): TvChannelId | undefined {
  return "parentId" in channel ? channel.parentId : undefined;
}

export function getTvChannel(id: TvChannelId): TvChannel {
  return TV_CHANNELS.find((channel) => channel.id === id) ?? TV_CHANNELS[0];
}

export function getTvChannelTabId(id: TvChannelId): TvChannelId {
  return channelParentId(getTvChannel(id)) ?? id;
}

export const TV_CHANNEL_TABS = TV_CHANNELS.filter((channel) => channelParentId(channel) == null);

export function getTvChannelStreams(tabId: TvChannelId): TvChannel[] {
  const resolvedTabId = getTvChannelTabId(tabId);
  const tab = getTvChannel(resolvedTabId);
  const streams = TV_CHANNELS.filter((channel) => channelParentId(channel) === resolvedTabId);
  return streams.length > 0 ? [tab, ...streams] : [tab];
}

const CHANNEL_ALIASES: Record<string, readonly string[]> = {
  kramer: ["cramer", "mad money", "jim cramer"],
  cnbc: ["cnbc tv"],
  "yahoo-finance": ["yahoo"],
  threadguy: ["notthreadguy"],
};

function channelHaystack(channel: TvChannel): string {
  const aliases = CHANNEL_ALIASES[channel.id] ?? [];
  return [channel.id, channel.name, ...aliases].join(" ").toLowerCase();
}

/** Command-bar / TV prefix matches against channel id, name, and aliases. */
export function matchTvChannels(query: string): TvChannel[] {
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 2);
  if (tokens.length === 0) return [];
  return TV_CHANNELS.filter((channel) => {
    const haystack = channelHaystack(channel);
    return tokens.every((token) => haystack.includes(token));
  });
}

export function findTvChannel(query: string): TvChannel | undefined {
  const needle = query.trim().toLowerCase();
  if (!needle) return undefined;
  return TV_CHANNELS.find((channel) => channel.id === needle || channel.name.toLowerCase() === needle)
    ?? matchTvChannels(needle)[0];
}
