import type { ChatChannel, ChatUserSummary } from "../../../api-client";

export type ChatPresenceLookup = {
  onlineUserIds?: readonly string[];
  onlineUsernames?: readonly string[];
};

export function isChatUserOnline(
  user: Pick<ChatUserSummary, "id" | "username" | "online"> | null | undefined,
  presence: ChatPresenceLookup,
): boolean {
  if (!user) return false;
  if (user.online === true) return true;
  if (user.id && presence.onlineUserIds?.includes(user.id)) return true;
  const username = user.username?.trim().toLowerCase();
  if (!username) return false;
  return (presence.onlineUsernames ?? []).some((entry) => entry.trim().toLowerCase() === username);
}

export function isDirectPeerOnline(
  channel: ChatChannel | undefined,
  presence: ChatPresenceLookup,
): boolean {
  if (!channel || channel.kind !== "direct") return false;
  return isChatUserOnline(channel.dmUser, presence);
}

export function isGroupChannelOnline(
  channel: ChatChannel | undefined,
  presence: ChatPresenceLookup,
): boolean {
  if (!channel || channel.kind !== "group") return false;
  return (channel.members ?? []).some((member) => isChatUserOnline(member, presence));
}

export function isSidebarChannelOnline(
  channel: ChatChannel | undefined,
  presence: ChatPresenceLookup,
): boolean {
  return isDirectPeerOnline(channel, presence) || isGroupChannelOnline(channel, presence);
}
