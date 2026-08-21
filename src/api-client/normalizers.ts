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

const PRESENCE_USER_ID_KEYS = [
  "onlineUserIds",
  "online_user_ids",
  "userIds",
  "user_ids",
  "onlineUsers",
  "online_users",
  "users",
] as const;
const PRESENCE_USERNAME_KEYS = [
  "onlineUsernames",
  "online_usernames",
  "usernames",
] as const;

function readIdToken(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function readStringIds(value: unknown): string[] {
  const ids: string[] = [];
  const push = (entry: unknown) => {
    const direct = readIdToken(entry);
    if (direct) {
      ids.push(direct);
      return;
    }
    if (!entry || typeof entry !== "object") return;
    const record = entry as { id?: unknown; userId?: unknown; user_id?: unknown };
    const nested = readIdToken(record.id) ?? readIdToken(record.userId) ?? readIdToken(record.user_id);
    if (nested) ids.push(nested);
  };
  if (Array.isArray(value)) {
    for (const entry of value) push(entry);
    return ids;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      const keyId = readIdToken(key);
      if (keyId && (entry === true || entry === 1 || (entry && typeof entry === "object"))) {
        ids.push(keyId);
      }
      push(entry);
    }
  }
  return ids;
}

function readUsernameToken(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return null;
  const record = value as { username?: unknown; handle?: unknown };
  if (typeof record.username === "string" && record.username.trim()) return record.username.trim();
  if (typeof record.handle === "string" && record.handle.trim()) return record.handle.trim();
  return null;
}

function readObjectUsernames(value: unknown): string[] {
  const usernames: string[] = [];
  const entries = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value)
      : [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const username = readUsernameToken(entry);
    if (username) usernames.push(username);
  }
  return usernames;
}

function readUsernames(value: unknown): string[] {
  if (!Array.isArray(value)) return readObjectUsernames(value);
  const usernames: string[] = [];
  for (const entry of value) {
    const username = readUsernameToken(entry);
    if (username) usernames.push(username);
  }
  return usernames;
}

function unwrapPresenceRecord(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const value = raw as Record<string, unknown>;
  const nested = value.data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return { ...value, ...(nested as Record<string, unknown>) };
  }
  return value;
}

function readOnlineCount(value: Record<string, unknown>): number {
  const count = value.onlineCount ?? value.online_count;
  if (typeof count === "number" && Number.isFinite(count)) return Math.max(0, Math.floor(count));
  return 0;
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
  const value = unwrapPresenceRecord(raw);
  const onlineCount = readOnlineCount(value);
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

export function isChatPresenceEvent(raw: unknown): boolean {
  const presence = normalizeChatPresence(raw);
  if (presence.hasUserList) return true;
  const value = unwrapPresenceRecord(raw);
  const count = value.onlineCount ?? value.online_count;
  return typeof count === "number" && Number.isFinite(count);
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
