import type { ChatChannel, ChatMessage } from "../../../api-client";
import { formatChatPaneTitle } from "./channel-labels";
import { normalizeChannelId } from "./controller/state";
import {
  chatMessageMentionsUsername,
  formatChatMessageSnippet,
  normalizeChatUsername,
} from "./controller/utils";

export const UNREAD_INBOX_PANE_ID = "unread-inbox";
export const UNREAD_INBOX_TEMPLATE_ID = "unread-inbox-pane";
export const UNREAD_INBOX_LIMIT = 12;

export interface UnreadInboxChannelState {
  channelId: string;
  unreadCount: number;
  lastViewedMessageId: string | null;
  messages: ChatMessage[];
}

export interface UnreadInboxItem {
  id: string;
  channelId: string;
  channelLabel: string;
  paneTitle: string;
  authorLabel: string;
  preview: string;
  messageId: string | null;
  createdAt: string;
  unreadInChannel: number;
}

function formatAuthorLabel(username: string | null | undefined): string {
  const trimmed = username?.trim();
  return trimmed ? `@${trimmed}` : "";
}

function getUnseenMessages(messages: ChatMessage[], lastViewedMessageId: string | null): ChatMessage[] {
  if (!lastViewedMessageId) return messages;
  const viewedIndex = messages.findIndex((message) => message.id === lastViewedMessageId);
  return viewedIndex >= 0 ? messages.slice(viewedIndex + 1) : messages;
}

function getMentionMessages(
  messages: ChatMessage[],
  user: { id: string; username: string } | null,
): ChatMessage[] {
  const normalizedUsername = normalizeChatUsername(user?.username);
  if (!normalizedUsername || messages.length === 0) return [];
  return messages.filter((message) => (
    message.user.id !== user?.id && chatMessageMentionsUsername(message.content, normalizedUsername)
  ));
}

function itemsForChannel(
  channel: ChatChannel | undefined,
  state: UnreadInboxChannelState,
  user: { id: string; username: string } | null,
): UnreadInboxItem[] {
  if (state.unreadCount <= 0) return [];

  const channelId = normalizeChannelId(state.channelId);
  const paneTitle = formatChatPaneTitle(channel, channelId);
  const unseen = getUnseenMessages(state.messages, state.lastViewedMessageId);
  const mentions = getMentionMessages(unseen, user);
  if (mentions.length > 0) {
    return mentions.map((message) => ({
      id: `${channelId}:${message.id}`,
      channelId,
      channelLabel: paneTitle,
      paneTitle,
      authorLabel: formatAuthorLabel(message.user.username),
      preview: formatChatMessageSnippet(message.content),
      messageId: message.id,
      createdAt: message.createdAt,
      unreadInChannel: state.unreadCount,
    }));
  }

  const latestUnseen = [...unseen].reverse().find((message) => message.user.id !== user?.id) ?? null;
  return [{
    id: `${channelId}:${latestUnseen?.id ?? "unread"}`,
    channelId,
    channelLabel: paneTitle,
    paneTitle,
    authorLabel: formatAuthorLabel(latestUnseen?.user.username),
    preview: latestUnseen ? formatChatMessageSnippet(latestUnseen.content) : "",
    messageId: latestUnseen?.id ?? null,
    createdAt: latestUnseen?.createdAt ?? "",
    unreadInChannel: state.unreadCount,
  }];
}

export function listUnreadInboxItems(options: {
  channels: ChatChannel[];
  states: UnreadInboxChannelState[];
  user: { id: string; username: string } | null;
  limit?: number;
}): UnreadInboxItem[] {
  const channelById = new Map(options.channels.map((channel) => [channel.id, channel]));
  const items = options.states.flatMap((state) => (
    itemsForChannel(channelById.get(state.channelId), state, options.user)
  ));
  items.sort((left, right) => {
    if (left.createdAt === right.createdAt) return right.id.localeCompare(left.id);
    if (!left.createdAt) return 1;
    if (!right.createdAt) return -1;
    return right.createdAt.localeCompare(left.createdAt);
  });
  return items.slice(0, options.limit ?? UNREAD_INBOX_LIMIT);
}

export function formatUnreadInboxRowLabel(item: UnreadInboxItem): string {
  if (item.messageId) {
    const head = item.authorLabel ? `${item.channelLabel}  ${item.authorLabel}` : item.channelLabel;
    return item.preview ? `${head}: ${item.preview}` : head;
  }
  if (item.unreadInChannel > 1) {
    return `${item.channelLabel}  ${item.unreadInChannel} unread`;
  }
  return item.preview ? `${item.channelLabel}  ${item.preview}` : `${item.channelLabel}  unread`;
}
