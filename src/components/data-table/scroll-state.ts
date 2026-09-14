export const TABLE_SCROLL_STATE_COMMIT_DELAY_MS = 300;

export function clampTableScrollIndex(value: unknown, itemCount: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || itemCount <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(Math.floor(value), itemCount - 1));
}

export function createDebouncedTableScrollWriter(
  commit: (index: number) => void,
  delayMs = TABLE_SCROLL_STATE_COMMIT_DELAY_MS,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: number | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending === null) return;
    const index = pending;
    pending = null;
    commit(index);
  };

  return {
    schedule(index: number) {
      pending = index;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
    flush,
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
