import type { CSSProperties } from "react";
import { t, tf } from "../../../../i18n";

export const ROW_COUNT_ANNOUNCE_INTERVAL_MS = 3_000;

export const VISUALLY_HIDDEN_STYLE: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  border: 0,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
};

export function rowCountMessage(count: number): string {
  if (count === 0) return t("No rows");
  if (count === 1) return t("1 row");
  return tf("{count} rows", { count });
}

export interface RowCountAnnouncer {
  update(count: number): void;
  dispose(): void;
}

/**
 * Announces row-count changes through a polite live region. The first count is
 * the baseline so mounting a layout of tables stays silent, and bursts (live
 * feeds, search typing) collapse into at most one message per interval with
 * the latest count as the trailing message.
 */
export function createRowCountAnnouncer(
  write: (message: string) => void,
  {
    minIntervalMs = ROW_COUNT_ANNOUNCE_INTERVAL_MS,
    now = Date.now,
  }: { minIntervalMs?: number; now?: () => number } = {},
): RowCountAnnouncer {
  let announcedCount: number | null = null;
  let pendingCount: number | null = null;
  let lastAnnouncedAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const announce = (count: number) => {
    clearTimer();
    pendingCount = null;
    announcedCount = count;
    lastAnnouncedAt = now();
    write(rowCountMessage(count));
  };

  return {
    update(count) {
      if (announcedCount === null) {
        announcedCount = count;
        return;
      }
      if (count === announcedCount) {
        clearTimer();
        pendingCount = null;
        return;
      }
      const wait = lastAnnouncedAt + minIntervalMs - now();
      if (wait <= 0) {
        announce(count);
        return;
      }
      pendingCount = count;
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null;
          if (pendingCount !== null) announce(pendingCount);
        }, wait);
      }
    },
    dispose() {
      clearTimer();
      pendingCount = null;
    },
  };
}
