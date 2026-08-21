type IdleCallback = () => void;

type IdleHost = typeof globalThis & {
  requestIdleCallback?: (callback: IdleCallback, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/**
 * Run `callback` when the event loop is idle, or after `timeoutMs` if the
 * browser never goes idle. Falls back to `setTimeout(0)` when IdleCallback
 * is unavailable (Bun tests, older runtimes).
 */
export function scheduleOnIdle(callback: IdleCallback, timeoutMs: number): () => void {
  const host = globalThis as IdleHost;
  if (typeof host.requestIdleCallback === "function") {
    const handle = host.requestIdleCallback(callback, { timeout: timeoutMs });
    return () => {
      host.cancelIdleCallback?.(handle);
    };
  }
  const timer = setTimeout(callback, 0);
  return () => clearTimeout(timer);
}
