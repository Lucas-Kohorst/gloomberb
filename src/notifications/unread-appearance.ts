import type { NotificationLogEntry } from "./notification-log";

export interface NotificationChatUnread {
  unreadCount: number;
  unreadMessageIds: ReadonlySet<string>;
}

const EMPTY_CHAT_UNREAD: NotificationChatUnread = {
  unreadCount: 0,
  unreadMessageIds: new Set(),
};

/**
 * Rows the Notifications pane should paint as unread.
 *
 * The status badge counts chat channel unread separately from log `read`.
 * A previous open used to persist every log row as read without clearing
 * those channel counts, so the pane said Read while the badge stayed up and
 * mark-all looked like a no-op. Chat rows that still account for the badge
 * stay unread here until mark-all clears both stores.
 */
export function notificationIdsThatAppearUnread(
  entries: readonly NotificationLogEntry[],
  chat: NotificationChatUnread = EMPTY_CHAT_UNREAD,
): Set<string> {
  const ids = new Set<string>();
  let matchedChat = 0;
  for (const entry of entries) {
    const chatMatch = !!entry.refId && chat.unreadMessageIds.has(entry.refId);
    if (!entry.read || chatMatch) {
      ids.add(entry.id);
      if (chatMatch) matchedChat += 1;
    }
  }
  const unmatched = Math.max(0, chat.unreadCount - matchedChat);
  if (unmatched === 0) return ids;
  const candidates = entries
    .filter((entry) => !!entry.refId && !ids.has(entry.id))
    .sort((left, right) => right.at - left.at);
  for (const entry of candidates.slice(0, unmatched)) ids.add(entry.id);
  return ids;
}
