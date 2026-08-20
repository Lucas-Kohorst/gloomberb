import { updatePaneInstance } from "../../../pane-settings";
import { removePane } from "../../pane-manager";
import type { AppConfig } from "../../../types/config";
import { LAST_VISITED_CHAT_CHANNEL_KEY, normalizeChannelId } from "./channels";
import type { UnreadInboxItem } from "./unread-inbox";

type ChatPaneSettings = Record<string, unknown>;

export function setChatPaneChannel(
  settings: ChatPaneSettings | undefined,
  nextChannelId: string,
): ChatPaneSettings {
  const normalizedNextChannelId = normalizeChannelId(nextChannelId);
  const currentChannelId = typeof settings?.channelId === "string"
    ? normalizeChannelId(settings.channelId)
    : null;
  const nextSettings = {
    ...(settings ?? {}),
    channelId: normalizedNextChannelId,
  };

  if (!currentChannelId || currentChannelId === normalizedNextChannelId) {
    return nextSettings;
  }

  return clearChatPaneTargetMessage(nextSettings);
}

export function clearChatPaneTargetMessage(
  settings: ChatPaneSettings | undefined,
): ChatPaneSettings {
  const { targetMessageId: _targetMessageId, ...nextSettings } = settings ?? {};
  return nextSettings;
}

export function setChatPaneJump(
  settings: ChatPaneSettings | undefined,
  channelId: string,
  targetMessageId: string | null | undefined,
): ChatPaneSettings {
  const nextSettings = setChatPaneChannel(settings, channelId);
  if (targetMessageId) {
    return { ...nextSettings, targetMessageId };
  }
  return clearChatPaneTargetMessage(nextSettings);
}

export function applyUnreadInboxItemToConfig(
  config: AppConfig,
  item: Pick<UnreadInboxItem, "channelId" | "messageId" | "paneTitle">,
  inboxInstanceId?: string | null,
): { config: AppConfig; chatInstanceId: string | null } {
  const existing = config.layout.instances.find((instance) => instance.paneId === "chat");
  let layout = config.layout;
  if (existing) {
    layout = updatePaneInstance(layout, existing.instanceId, (instance) => ({
      ...instance,
      title: item.paneTitle,
      settings: setChatPaneJump(instance.settings, item.channelId, item.messageId),
    }));
  }
  if (inboxInstanceId) {
    layout = removePane(layout, inboxInstanceId);
  }

  return {
    config: {
      ...config,
      layout,
      pluginConfig: {
        ...config.pluginConfig,
        "gloomberb-cloud": {
          ...(config.pluginConfig["gloomberb-cloud"] ?? {}),
          [LAST_VISITED_CHAT_CHANNEL_KEY]: item.channelId,
        },
      },
    },
    chatInstanceId: existing?.instanceId ?? null,
  };
}
