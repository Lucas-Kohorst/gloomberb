import type { PaneSettingsDef } from "../../../types/plugin";
import { chatController } from "./controller";
import {
  DEFAULT_CHAT_CHANNEL_ID,
  LAST_VISITED_CHAT_CHANNEL_KEY,
  formatChannelLabel,
  normalizeChannelId,
} from "./channels";

function channelOptions(currentChannelId: string) {
  const channels = chatController.getChannels();
  const options = channels
    .filter((channel) => channel.kind !== "direct" && channel.kind !== "group")
    .map((channel) => ({
      value: channel.id,
      label: formatChannelLabel(channel, channel.id),
      description: channel.kind === "public" ? "Public channel" : undefined,
    }));
  if (options.length === 0) {
    options.push({
      value: DEFAULT_CHAT_CHANNEL_ID,
      label: `#${DEFAULT_CHAT_CHANNEL_ID}`,
      description: undefined,
    });
  }
  if (currentChannelId && !options.some((option) => option.value === currentChannelId)) {
    const current = channels.find((channel) => channel.id === currentChannelId);
    options.push({
      value: currentChannelId,
      label: formatChannelLabel(current, currentChannelId),
      description: current?.kind === "direct"
        ? "Direct message"
        : current?.kind === "group"
          ? "Group chat"
          : undefined,
    });
  }
  return options;
}

export function buildChatPaneSettingsDef(
  settings: Record<string, unknown> | undefined,
): PaneSettingsDef {
  const channelId = normalizeChannelId(
    typeof settings?.channelId === "string" ? settings.channelId : DEFAULT_CHAT_CHANNEL_ID,
  );
  const defaultChannelId = normalizeChannelId(
    typeof settings?.[LAST_VISITED_CHAT_CHANNEL_KEY] === "string"
      ? settings[LAST_VISITED_CHAT_CHANNEL_KEY] as string
      : channelId,
  );
  const options = channelOptions(channelId);
  return {
    title: "Chat Settings",
    values: {
      channelId,
      [LAST_VISITED_CHAT_CHANNEL_KEY]: defaultChannelId,
    },
    fields: [
      {
        key: "channelId",
        label: "Channel",
        description: "Channel shown in this pane.",
        type: "select",
        options,
      },
      {
        key: LAST_VISITED_CHAT_CHANNEL_KEY,
        label: "Default channel",
        description: "Used when opening a new chat pane.",
        type: "select",
        storage: "plugin",
        options,
      },
    ],
  };
}
