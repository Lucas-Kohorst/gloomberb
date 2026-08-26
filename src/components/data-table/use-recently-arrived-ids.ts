import { useEffect, useRef, useState } from "react";
import {
  activeArrivalIds,
  createArrivalTracker,
  MAX_TRACKED_SEEN_IDS,
  nextArrivalEventAt,
  observeItemIds,
  type ArrivalTracker,
} from "./recently-arrived";

const EMPTY_ARRIVAL_IDS: ReadonlySet<string> = new Set();

function capObservedIds(ids: readonly string[]): readonly string[] {
  return ids.length > MAX_TRACKED_SEEN_IDS ? ids.slice(0, MAX_TRACKED_SEEN_IDS) : ids;
}

function sameIdList(left: readonly string[] | null, right: readonly string[]): boolean {
  if (left === null) return false;
  if (left.length !== right.length) return false;
  return left.every((id, index) => id === right[index]);
}

/**
 * Returns the set of row ids that should currently show a roll-in highlight.
 * First observation primes silently. Timers are coalesced to the next reveal
 * or expiry so staggered batches do not schedule one timer per row.
 */
export function useRecentlyArrivedIds(ids: readonly string[]): ReadonlySet<string> {
  const trackerRef = useRef<ArrivalTracker>(createArrivalTracker());
  const prevIdsRef = useRef<readonly string[] | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeIds, setActiveIds] = useState<ReadonlySet<string>>(EMPTY_ARRIVAL_IDS);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const publish = (now: number) => {
      const next = activeArrivalIds(trackerRef.current, now);
      setActiveIds((current) => {
        if (current.size === next.size && [...current].every((id) => next.has(id))) {
          return current;
        }
        return next.size === 0 ? EMPTY_ARRIVAL_IDS : next;
      });
    };

    const scheduleNext = () => {
      clearTimer();
      const now = Date.now();
      const nextAt = nextArrivalEventAt(trackerRef.current, now);
      if (nextAt === null) {
        publish(now);
        return;
      }

      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const tick = Date.now();
        trackerRef.current = {
          ...trackerRef.current,
          arrivals: trackerRef.current.arrivals.filter((entry) => entry.expiresAt > tick),
        };
        publish(tick);
        scheduleNext();
      }, Math.max(0, nextAt - now));
    };

    const observed = capObservedIds(ids);
    if (!sameIdList(prevIdsRef.current, observed)) {
      prevIdsRef.current = observed;
      const now = Date.now();
      trackerRef.current = observeItemIds(trackerRef.current, observed, now);
      publish(now);
    } else {
      publish(Date.now());
    }
    // Re-arm after every effect run: React cleanup clears the prior timer
    // even when the id list content is unchanged.
    scheduleNext();

    return clearTimer;
  }, [ids]);

  return activeIds;
}
