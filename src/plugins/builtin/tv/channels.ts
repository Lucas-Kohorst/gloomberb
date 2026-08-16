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

export function getTvChannel(id: TvChannelId): TvChannel {
  return TV_CHANNELS.find((channel) => channel.id === id) ?? TV_CHANNELS[0];
}
