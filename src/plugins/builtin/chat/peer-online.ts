import type { ChatChannel } from "../../../api-client";

export function isDirectPeerOnline(
  channel: ChatChannel | undefined,
  presence: {
    onlineUserIds?: readonly string[];
    onlineUsernames?: readonly string[];
  },
): boolean {
  if (!channel || channel.kind !== "direct") return false;
  const peer = channel.dmUser;
  if (!peer) return false;
  if (peer.online === true) return true;
  if (peer.id && presence.onlineUserIds?.includes(peer.id)) return true;
  const username = peer.username?.trim().toLowerCase();
  if (!username) return false;
  return (presence.onlineUsernames ?? []).some((entry) => entry.trim().toLowerCase() === username);
}
