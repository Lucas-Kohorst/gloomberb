export type NotificationSourceFilter = "all" | "alerts" | "chat" | "team";

const FILTERS: readonly NotificationSourceFilter[] = ["all", "alerts", "chat", "team"];

let pending: NotificationSourceFilter | null = null;
const listeners = new Set<(filter: NotificationSourceFilter) => void>();

export function isNotificationSourceFilter(value: string): value is NotificationSourceFilter {
  return (FILTERS as readonly string[]).includes(value);
}

/** The next time the notification center opens, or immediately if it is already open. */
export function requestNotificationCenterFilter(filter: NotificationSourceFilter): void {
  pending = filter;
  if (listeners.size === 0) return;
  for (const listener of listeners) listener(filter);
  pending = null;
}

export function consumeRequestedNotificationCenterFilter(): NotificationSourceFilter | null {
  const filter = pending;
  pending = null;
  return filter;
}

export function subscribeRequestedNotificationCenterFilter(
  listener: (filter: NotificationSourceFilter) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notificationSourceVisible(source: string, filter: NotificationSourceFilter): boolean {
  if (filter === "all") return true;
  if (filter === "team") return source === "team";
  if (filter === "alerts") return source === "alerts";
  if (filter === "chat") return source === "chat" || source === "gloomberb-cloud";
  return true;
}
