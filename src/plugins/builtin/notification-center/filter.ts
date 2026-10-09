export type NotificationSourceFilter = "all" | "alerts" | "chat" | "team";

export const NOTIFICATION_CENTER_TEMPLATE_ID = "notification-center-pane";

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

export function priceAlertIdFromRef(refId: string | undefined): string | null {
  if (!refId?.startsWith("price:")) return null;
  const id = refId.slice("price:".length);
  return id || null;
}

export function catalystEventIdFromRef(refId: string | undefined): string | null {
  if (!refId?.startsWith("catalyst:")) return null;
  const id = refId.slice("catalyst:".length);
  return id || null;
}

/** Chat and team rows carry a refId and are counted on their own chips. */
export function notificationCountsOnStatusBadge(entry: { read: boolean; refId?: string }): boolean {
  if (entry.read) return false;
  if (!entry.refId) return true;
  return priceAlertIdFromRef(entry.refId) != null || catalystEventIdFromRef(entry.refId) != null;
}

export function notificationSourceVisible(source: string, filter: NotificationSourceFilter): boolean {
  if (filter === "all") return true;
  if (filter === "team") return source === "team";
  if (filter === "alerts") return source === "alerts";
  if (filter === "chat") return source === "chat" || source === "gloomberb-cloud";
  return true;
}

/** Raw source ids stay off the screen. */
export function notificationSourceLabel(source: string): string {
  if (source === "alerts") return "Alerts";
  if (source === "chat" || source === "gloomberb-cloud") return "Chat";
  if (source === "team") return "Team";
  return "App";
}
