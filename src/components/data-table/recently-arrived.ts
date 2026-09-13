/**
 * Tracks which table row ids are newly arrived so UIs can briefly highlight
 * them (wire-terminal "roll in") without treating the initial hydrate as new.
 *
 * Identity is the caller's stable row id (article id / feed item id). Seen ids
 * persist across filter shrink/grow so reappearing rows do not re-animate.
 */

export const ARRIVAL_HIGHLIGHT_MS = 850;
export const ARRIVAL_STAGGER_MS = 40;
export const MAX_TRACKED_SEEN_IDS = 1500;

export interface ArrivalEntry {
  id: string;
  /** When the highlight becomes active (stagger start). */
  revealAt: number;
  /** When the highlight ends. */
  expiresAt: number;
}

export interface ArrivalTracker {
  primed: boolean;
  /** Most-recently-seen first; capped for memory. */
  seenIds: string[];
  arrivals: ArrivalEntry[];
  /** Newest `timestamps` value observed after prime; backfill older than this does not flash. */
  newestAt: number | null;
}

export function createArrivalTracker(): ArrivalTracker {
  return { primed: false, seenIds: [], arrivals: [], newestAt: null };
}

function rememberIds(current: readonly string[], ids: readonly string[]): string[] {
  const next: string[] = [];
  const included = new Set<string>();

  for (const id of ids) {
    if (included.has(id)) continue;
    included.add(id);
    next.push(id);
    if (next.length >= MAX_TRACKED_SEEN_IDS) return next;
  }

  for (const id of current) {
    if (included.has(id)) continue;
    included.add(id);
    next.push(id);
    if (next.length >= MAX_TRACKED_SEEN_IDS) break;
  }

  return next;
}

function pruneArrivals(arrivals: readonly ArrivalEntry[], now: number): ArrivalEntry[] {
  return arrivals.filter((entry) => entry.expiresAt > now);
}

function newestTimestamp(
  ids: readonly string[],
  timestamps: ReadonlyMap<string, number> | undefined,
  fallback: number | null,
): number | null {
  if (!timestamps || timestamps.size === 0) return fallback;
  let newest = fallback;
  for (const id of ids) {
    const at = timestamps.get(id);
    if (at == null || !Number.isFinite(at)) continue;
    newest = newest == null ? at : Math.max(newest, at);
  }
  return newest;
}

/**
 * Observe the current visible (or full) id list. First observation primes
 * without arrivals. Later observations mark unseen ids as rolling in, with
 * a short stagger so a batch reads as a cascade rather than a flash.
 *
 * When `timestamps` is provided (publishedAt / event time), only ids newer
 * than the previously newest row highlight. Older backfill — RSS feeds
 * landing 10 rows down — is remembered silently.
 */
export function observeItemIds(
  tracker: ArrivalTracker,
  ids: readonly string[],
  now: number,
  timestamps?: ReadonlyMap<string, number>,
): ArrivalTracker {
  const observed = ids.length > MAX_TRACKED_SEEN_IDS
    ? ids.slice(0, MAX_TRACKED_SEEN_IDS)
    : ids;
  const arrivals = pruneArrivals(tracker.arrivals, now);
  const newestAt = newestTimestamp(observed, timestamps, tracker.newestAt);

  if (!tracker.primed) {
    // Stay unprimed on an empty list so the first real hydrate does not
    // animate every row as if it just arrived on the wire.
    if (observed.length === 0) return tracker;
    return {
      primed: true,
      seenIds: rememberIds([], observed),
      arrivals: [],
      newestAt,
    };
  }

  const seen = new Set(tracker.seenIds);
  const previousNewest = tracker.newestAt;
  const fresh: string[] = [];
  for (const id of observed) {
    if (seen.has(id)) continue;
    seen.add(id);
    const at = timestamps?.get(id);
    const isLiveHead = timestamps == null
      || previousNewest == null
      || (at != null && Number.isFinite(at) && at > previousNewest);
    if (isLiveHead) fresh.push(id);
  }

  const newArrivals = fresh.map((id, index) => {
    const revealAt = now + index * ARRIVAL_STAGGER_MS;
    return {
      id,
      revealAt,
      expiresAt: revealAt + ARRIVAL_HIGHLIGHT_MS,
    };
  });

  if (fresh.length === 0 && arrivals.length === tracker.arrivals.length && newestAt === tracker.newestAt) {
    const nextSeen = rememberIds(tracker.seenIds, observed);
    if (
      nextSeen.length === tracker.seenIds.length
      && nextSeen.every((id, index) => id === tracker.seenIds[index])
    ) {
      return tracker;
    }
    return { ...tracker, seenIds: nextSeen, arrivals, newestAt };
  }

  return {
    primed: true,
    seenIds: rememberIds(tracker.seenIds, observed),
    arrivals: [...arrivals, ...newArrivals],
    newestAt,
  };
}

export function activeArrivalIds(
  tracker: ArrivalTracker,
  now: number,
): ReadonlySet<string> {
  const active = new Set<string>();
  for (const entry of tracker.arrivals) {
    if (now >= entry.revealAt && now < entry.expiresAt) {
      active.add(entry.id);
    }
  }
  return active;
}

/** Soonest reveal or expiry after `now`, for scheduling a single timer. */
export function nextArrivalEventAt(
  tracker: ArrivalTracker,
  now: number,
): number | null {
  let next: number | null = null;
  for (const entry of tracker.arrivals) {
    if (entry.revealAt > now) {
      next = next === null ? entry.revealAt : Math.min(next, entry.revealAt);
    }
    if (entry.expiresAt > now) {
      next = next === null ? entry.expiresAt : Math.min(next, entry.expiresAt);
    }
  }
  return next;
}
