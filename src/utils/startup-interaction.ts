type Resolve = () => void;

type IdleHost = typeof globalThis & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/**
 * Cap so background pane fetches (RSS, Adjacent, PM catalogs, extra quotes)
 * start within a few hundred ms of first paint instead of waiting for a truly
 * idle machine that a dense Home layout never reaches.
 */
export const STARTUP_BACKGROUND_IDLE_TIMEOUT_MS = 400;

let deferred = false;
let interactive = true;
let waiters: Resolve[] = [];
let cancelIdleMark: (() => void) | null = null;

function flushWaiters(): void {
  const pending = waiters;
  waiters = [];
  for (const resolve of pending) resolve();
}

function armIdleBackup(): void {
  cancelIdleMark?.();
  const host = globalThis as IdleHost;
  const timer = setTimeout(() => {
    markStartupInteractive();
  }, STARTUP_BACKGROUND_IDLE_TIMEOUT_MS);
  let idleHandle: number | undefined;
  if (typeof host.requestIdleCallback === "function") {
    idleHandle = host.requestIdleCallback(() => {
      markStartupInteractive();
    }, { timeout: STARTUP_BACKGROUND_IDLE_TIMEOUT_MS });
  }
  cancelIdleMark = () => {
    clearTimeout(timer);
    if (idleHandle != null) host.cancelIdleCallback?.(idleHandle);
  };
}

/**
 * Hosted/desktop web first load: keep the first pointer frames free for move,
 * resize, click, chat, and the command bar. Call once before `root.render`.
 */
export function enableStartupNetworkDeferral(): void {
  deferred = true;
  interactive = false;
  armIdleBackup();
}

/** First paint committed (or idle timeout). Background fetches may start. */
export function markStartupInteractive(): void {
  if (interactive) return;
  interactive = true;
  cancelIdleMark?.();
  cancelIdleMark = null;
  flushWaiters();
}

export function isStartupNetworkDeferred(): boolean {
  return deferred && !interactive;
}

/**
 * Resolves immediately unless `enableStartupNetworkDeferral()` ran and first
 * paint has not been marked yet. Tests and the TUI never enable deferral.
 */
export function whenStartupBackground(): Promise<void> {
  if (!deferred || interactive) return Promise.resolve();
  return new Promise((resolve) => {
    waiters.push(resolve);
  });
}

/** Double-rAF so the first App commit paints before RSS/PM/Adjacent stampede. */
export function armStartupInteractiveAfterFirstPaint(): void {
  const raf = globalThis.requestAnimationFrame;
  if (typeof raf !== "function") {
    markStartupInteractive();
    return;
  }
  raf(() => {
    raf(() => {
      markStartupInteractive();
    });
  });
}

export function runAfterStartupBackground(task: () => void): () => void {
  if (!deferred || interactive) {
    task();
    return () => {};
  }
  let cancelled = false;
  void whenStartupBackground().then(() => {
    if (!cancelled) task();
  });
  return () => {
    cancelled = true;
  };
}

export function resetStartupInteractionForTests(): void {
  deferred = false;
  interactive = true;
  waiters = [];
  cancelIdleMark?.();
  cancelIdleMark = null;
}
