import type { CommandBarResultDef, CommandBarSearchProvider, GloomPluginContext } from "../../../types/plugin";
import { matchTvChannels, type TvChannel } from "./channels";

const RESULT_LIMIT = 6;

export function tvChannelSearchResults(
  query: string,
  openChannel: (channel: TvChannel) => void,
): CommandBarResultDef[] {
  return matchTvChannels(query).slice(0, RESULT_LIMIT).map((channel) => ({
    id: channel.id,
    label: channel.name,
    detail: "Live TV",
    right: "TV",
    keywords: [channel.id, channel.name, "tv", "television"],
    execute: () => openChannel(channel),
  }));
}

export function createTvChannelSearchProvider(ctx: GloomPluginContext): CommandBarSearchProvider {
  return {
    id: "macro-tv-channels",
    category: "TV",
    priority: 120,
    minQueryLength: 3,
    debounceMs: 150,
    async provide(query) {
      return tvChannelSearchResults(query, (channel) => {
        ctx.createPaneFromTemplate("macro-tv-pane", { arg: channel.id });
      });
    },
  };
}
