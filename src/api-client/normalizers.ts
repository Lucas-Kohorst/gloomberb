import type {
  ChatChannel,
  ChatMessage,
  ChatNotification,
  ChatPresence,
  ChatStateResponse,
  CloudTweetPayload,
  CloudTweetSearchResponse,
} from "./types";
import { normalizeTimestamp } from "../utils/timestamp";

export function normalizeChatMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    createdAt: normalizeTimestamp(message.createdAt),
    ...(message.editedAt ? { editedAt: normalizeTimestamp(message.editedAt) } : {}),
  };
}

export function normalizeChatMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => normalizeChatMessage(message));
}

export function normalizeChatNotification(notification: ChatNotification): ChatNotification {
  return {
    ...notification,
    createdAt: normalizeTimestamp(notification.createdAt),
    message: normalizeChatMessage(notification.message),
  };
}

export function normalizeChatChannel(channel: ChatChannel, fallbackKind: ChatChannel["kind"] = "public"): ChatChannel {
  return {
    ...channel,
    kind: channel.kind ?? fallbackKind,
    created_at: normalizeTimestamp(channel.created_at),
  };
}

export function normalizeChatState(response: ChatStateResponse): ChatStateResponse {
  return {
    ...response,
    channels: response.channels.map((channel) => normalizeChatChannel(channel)),
    notifications: response.notifications.map(normalizeChatNotification),
  };
}

const PRESENCE_USER_ID_KEYS = ["onlineUserIds", "userIds", "onlineUsers", "users"] as const;
const PRESENCE_USERNAME_KEYS = ["onlineUsernames", "usernames"] as const;

function readStringIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim()) {
      ids.push(entry.trim());
      continue;
    }
    if (entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string") {
      const id = (entry as { id: string }).id.trim();
      if (id) ids.push(id);
    }
  }
  return ids;
}

function readObjectUsernames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const usernames: string[] = [];
  for (const entry of value) {
    if (entry && typeof entry === "object" && typeof (entry as { username?: unknown }).username === "string") {
      const username = (entry as { username: string }).username.trim();
      if (username) usernames.push(username);
    }
  }
  return usernames;
}

function readUsernames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const usernames: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim()) {
      usernames.push(entry.trim());
      continue;
    }
    if (entry && typeof entry === "object" && typeof (entry as { username?: unknown }).username === "string") {
      const username = (entry as { username: string }).username.trim();
      if (username) usernames.push(username);
    }
  }
  return usernames;
}

export function emptyChatPresence(onlineCount = 0): ChatPresence {
  return {
    onlineCount,
    onlineUserIds: [],
    onlineUsernames: [],
    hasUserList: false,
  };
}

export function normalizeChatPresence(raw: unknown): ChatPresence {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const onlineCount = typeof value.onlineCount === "number" && Number.isFinite(value.onlineCount)
    ? Math.max(0, Math.floor(value.onlineCount))
    : 0;
  const onlineUserIds = new Set<string>();
  const onlineUsernames = new Set<string>();
  let hasUserList = false;

  for (const key of PRESENCE_USER_ID_KEYS) {
    if (!(key in value)) continue;
    hasUserList = true;
    for (const id of readStringIds(value[key])) onlineUserIds.add(id);
    for (const username of readObjectUsernames(value[key])) onlineUsernames.add(username);
  }
  for (const key of PRESENCE_USERNAME_KEYS) {
    if (!(key in value)) continue;
    hasUserList = true;
    for (const username of readUsernames(value[key])) onlineUsernames.add(username);
  }

  return {
    onlineCount,
    onlineUserIds: [...onlineUserIds],
    onlineUsernames: [...onlineUsernames],
    hasUserList,
  };
}

export function mergeChatPresence(current: ChatPresence, incoming: ChatPresence): ChatPresence {
  if (!incoming.hasUserList) {
    return {
      ...current,
      onlineCount: incoming.onlineCount,
    };
  }
  return incoming;
}

function normalizeTweet(tweet: CloudTweetPayload): CloudTweetPayload {
  return {
    ...tweet,
    createdAt: normalizeTimestamp(tweet.createdAt),
  };
}

export function normalizeTweetSearchResponse(response: CloudTweetSearchResponse): CloudTweetSearchResponse {
  return {
    ...response,
    since: normalizeTimestamp(response.since),
    until: normalizeTimestamp(response.until),
    asOf: normalizeTimestamp(response.asOf),
    tweets: response.tweets.map(normalizeTweet),
  };
}
