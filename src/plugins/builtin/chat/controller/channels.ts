import {
  apiClient,
  emptyChatPresence,
  mergeChatPresence,
  normalizeChatPresence,
  type ChatChannel,
  type ChatChannelState,
  type ChatNotification,
  type ChatPresence,
} from "../../../../api-client";
import {
  DEFAULT_CHAT_CHANNEL_ID,
  normalizeChannelId,
  normalizeChannels,
  type ChannelRuntimeState,
} from "./state";

interface ChatControllerChannelsOptions {
  canLoadPrivateState: () => boolean;
  ensureChannelState: (channelId: string) => ChannelRuntimeState;
  getChannelStateIds: () => Iterable<string>;
  handleNotification: (notification: ChatNotification, options?: { countUnread?: boolean }) => void;
  ensureOpenChannelConnections: () => void;
  emit: (channelId?: string) => void;
}

export class ChatControllerChannels {
  private channels: ChatChannel[] = [];
  private presence = emptyChatPresence();
  private channelsLoading = false;
  private channelsPromise: Promise<void> | null = null;

  constructor(private readonly options: ChatControllerChannelsOptions) {}

  getChannels(): ChatChannel[] {
    return this.channels;
  }

  getOnlineCount(): number {
    return this.presence.onlineCount;
  }

  getOnlineUserIds(): string[] {
    return this.presence.onlineUserIds;
  }

  getOnlineUsernames(): string[] {
    return this.presence.onlineUsernames;
  }

  applyPresence(presence: ChatPresence | { onlineCount: number }): void {
    this.presence = mergeChatPresence(this.presence, normalizeChatPresence(presence));
  }

  isLoading(): boolean {
    return this.channelsLoading;
  }

  getChannelStateSnapshots(): ChatChannelState[] {
    const channelIds = new Set<string>([
      ...this.channels.map((channel) => channel.id),
      ...this.options.getChannelStateIds(),
    ]);
    return [...channelIds].map((channelId) => {
      const channel = this.options.ensureChannelState(channelId);
      return {
        channelId,
        notificationsEnabled: channel.notificationsEnabled,
        lastReadMessageId: channel.lastViewedMessageId,
        unreadCount: channel.unreadCount,
      };
    });
  }

  async refreshChannels(): Promise<void> {
    if (this.channelsPromise) return this.channelsPromise;
    this.channelsLoading = true;
    this.options.emit();

    const request = apiClient.getChannels()
      .then((channels) => {
        this.channels = normalizeChannels(channels);
      })
      .catch(() => {
        // Keep the last backend-provided list if the refresh fails.
      })
      .finally(() => {
        this.channelsLoading = false;
        this.channelsPromise = null;
        this.options.emit();
      });

    this.channelsPromise = request;
    return request;
  }

  async refreshPresence(): Promise<void> {
    this.applyPresence(await apiClient.getChatPresence());
    this.options.emit();
  }

  async refreshChatState(): Promise<void> {
    if (!this.options.canLoadPrivateState()) {
      await this.refreshPresence();
      return;
    }
    const state = await apiClient.getChatState();
    this.channels = normalizeChannels(state.channels);
    this.applyPresence(state);
    for (const entry of state.channelStates) {
      const channel = this.options.ensureChannelState(entry.channelId);
      channel.notificationsEnabled = entry.notificationsEnabled;
      channel.unreadCount = entry.unreadCount;
      channel.lastViewedMessageId = entry.lastReadMessageId ?? channel.lastViewedMessageId;
    }
    for (const notification of state.notifications) {
      this.options.handleNotification(notification, { countUnread: false });
    }
    this.options.ensureOpenChannelConnections();
    this.options.emit();
  }

  async openDirectChannel(target: { userId?: string; username?: string }): Promise<ChatChannel> {
    return this.registerOpenedChannel(await apiClient.openDirectChannel(target));
  }

  async openGroupChannel(body: { userIds?: string[]; usernames?: string[]; name?: string }): Promise<ChatChannel> {
    return this.registerOpenedChannel(await apiClient.openGroupChannel(body));
  }

  async resolveRequiredChannelId(channelId: string): Promise<string> {
    const resolved = this.resolveKnownChannelId(normalizeChannelId(channelId));
    if (resolved) return resolved;
    await this.refreshChannels();
    const refreshed = this.resolveKnownChannelId(normalizeChannelId(channelId));
    if (refreshed) return refreshed;
    throw new Error(`Unknown chat channel "#${normalizeChannelId(channelId)}".`);
  }

  async resolvePreferredChannelId(channelId: string | null | undefined): Promise<string> {
    const normalizedChannelId = normalizeChannelId(channelId);
    if (this.isKnownChannelId(normalizedChannelId)) {
      return normalizedChannelId;
    }
    await this.refreshChannels();
    if (this.isKnownChannelId(normalizedChannelId)) {
      return normalizedChannelId;
    }
    if (this.isKnownChannelId(DEFAULT_CHAT_CHANNEL_ID)) {
      return DEFAULT_CHAT_CHANNEL_ID;
    }
    return this.channels[0]?.id ?? DEFAULT_CHAT_CHANNEL_ID;
  }

  private registerOpenedChannel(channel: ChatChannel): ChatChannel {
    this.channels = normalizeChannels([...this.channels, channel]);
    this.options.ensureChannelState(channel.id);
    this.options.ensureOpenChannelConnections();
    this.options.emit(channel.id);
    this.options.emit();
    return channel;
  }

  private isKnownChannelId(channelId: string): boolean {
    return this.channels.some((channel) => channel.id === channelId);
  }

  private resolveKnownChannelId(channelId: string): string | null {
    const normalized = channelId.trim().replace(/^#+/, "").toLowerCase();
    if (!normalized) return null;
    const exactId = this.channels.find((channel) => channel.id.toLowerCase() === normalized);
    if (exactId) return exactId.id;
    const exactName = this.channels.find((channel) => channel.name.trim().toLowerCase() === normalized);
    if (exactName) return exactName.id;
    const prefixMatches = this.channels.filter((channel) => {
      const id = channel.id.toLowerCase();
      const name = channel.name.trim().toLowerCase();
      return id.startsWith(normalized) || name.startsWith(normalized);
    });
    return prefixMatches.length === 1 ? prefixMatches[0]!.id : null;
  }
}
