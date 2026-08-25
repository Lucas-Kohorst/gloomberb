import type { ChatChannel, ChatUserSummary } from "../../../api-client";

export type ChatPresenceLookup = {
  onlineUserIds?: readonly string[];
  onlineUsernames?: readonly string[];
  selfUserId?: string | null;
  selfUsername?: string | null;
};

function normalizePresenceUsername(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/^@+/, "").toLowerCase();
  return normalized || null;
}

function isSelfUser(
  user: Pick<ChatUserSummary, "id" | "username"> | null | undefined,
  presence: ChatPresenceLookup,
): boolean {
  if (!user) return false;
  if (presence.selfUserId && user.id && presence.selfUserId === user.id) return true;
  const selfUsername = normalizePresenceUsername(presence.selfUsername);
  const username = normalizePresenceUsername(user.username);
  return !!selfUsername && selfUsername === username;
}

function presenceHasUsername(presence: ChatPresenceLookup, username: string): boolean {
  return (presence.onlineUsernames ?? []).some((entry) => normalizePresenceUsername(entry) === username);
}

function parseMentionUsernames(value: string | null | undefined): string[] {
  if (!value) return [];
  const names = new Set<string>();
  for (const match of value.matchAll(/@([A-Za-z][A-Za-z0-9_]{2,29})/g)) {
    const username = normalizePresenceUsername(match[1]);
    if (username) names.add(username);
  }
  return [...names];
}

export function isChatUserOnline(
  user: Pick<ChatUserSummary, "id" | "username" | "online"> | null | undefined,
  presence: ChatPresenceLookup,
): boolean {
  if (!user) return false;
  if (user.online === true) return true;
  if (user.id && presence.onlineUserIds?.includes(user.id)) return true;
  const username = normalizePresenceUsername(user.username);
  if (!username) return false;
  return presenceHasUsername(presence, username);
}

export function isDirectPeerOnline(
  channel: ChatChannel | undefined,
  presence: ChatPresenceLookup,
): boolean {
  if (!channel || channel.kind !== "direct") return false;
  if (channel.dmUser) return isChatUserOnline(channel.dmUser, presence);

  const username = normalizePresenceUsername(channel.name)
    ?? (channel.id.startsWith("dm:") ? normalizePresenceUsername(channel.id.slice(3)) : null);
  if (username && presenceHasUsername(presence, username)) return true;

  const idSuffix = channel.id.startsWith("dm:") ? channel.id.slice(3).trim() : "";
  return !!idSuffix && (presence.onlineUserIds?.includes(idSuffix) ?? false);
}

export function isGroupChannelOnline(
  channel: ChatChannel | undefined,
  presence: ChatPresenceLookup,
): boolean {
  if (!channel || channel.kind !== "group") return false;
  const members = channel.members ?? [];
  if (members.length > 0) {
    return members.some((member) => !isSelfUser(member, presence) && isChatUserOnline(member, presence));
  }
  const selfUsername = normalizePresenceUsername(presence.selfUsername);
  return parseMentionUsernames(channel.name).some((username) => (
    username !== selfUsername && presenceHasUsername(presence, username)
  ));
}

export function isSidebarChannelOnline(
  channel: ChatChannel | undefined,
  presence: ChatPresenceLookup,
): boolean {
  return isDirectPeerOnline(channel, presence) || isGroupChannelOnline(channel, presence);
}
