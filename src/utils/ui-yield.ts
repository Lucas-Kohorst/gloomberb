type UiYieldReason = "input" | "command-bar" | "pointer";
type Resolve = () => void;
type YieldListener = (yielding: boolean) => void;

/** After the last key/pointer, wait this long before Firehose/quotes resume. */
export const UI_YIELD_QUIET_MS = 250;
/** Stuck pointerdown without an up must not starve background work forever. */
export const UI_YIELD_MAX_POINTER_MS = 10_000;

const reasons = new Set<UiYieldReason>();
let lastInteractionAt = 0;
let pointerStartedAt = 0;
let lastYielding = false;
let quietTimer: ReturnType<typeof setTimeout> | null = null;
let waiters: Resolve[] = [];
const listeners = new Set<YieldListener>();
let coalesceEnabled = false;

function flushWaiters(): void {
  const pending = waiters;
  waiters = [];
  for (const resolve of pending) resolve();
}

function clearQuietTimer(): void {
  if (quietTimer == null) return;
  clearTimeout(quietTimer);
  quietTimer = null;
}

export function shouldYieldToUi(now = Date.now()): boolean {
  if (reasons.has("input") || reasons.has("command-bar")) return true;
  if (reasons.has("pointer")) {
    if (pointerStartedAt > 0 && now - pointerStartedAt >= UI_YIELD_MAX_POINTER_MS) {
      return false;
    }
    return true;
  }
  if (lastInteractionAt === 0) return false;
  return now - lastInteractionAt < UI_YIELD_QUIET_MS;
}

function emitYieldChange(): void {
  const next = shouldYieldToUi();
  if (next !== lastYielding) {
    lastYielding = next;
    for (const listener of listeners) listener(next);
  }
  if (!next) flushWaiters();
}

function scheduleYieldPump(): void {
  clearQuietTimer();
  const now = Date.now();
  emitYieldChange();
  if (!shouldYieldToUi(now)) return;

  if (reasons.size === 0 && lastInteractionAt > 0) {
    const wait = Math.max(0, UI_YIELD_QUIET_MS - (now - lastInteractionAt));
    quietTimer = setTimeout(() => {
      quietTimer = null;
      emitYieldChange();
    }, wait + 1);
    return;
  }

  if (reasons.has("pointer") && !reasons.has("input") && !reasons.has("command-bar") && pointerStartedAt > 0) {
    const wait = Math.max(0, UI_YIELD_MAX_POINTER_MS - (now - pointerStartedAt));
    quietTimer = setTimeout(() => {
      quietTimer = null;
      emitYieldChange();
    }, wait + 1);
  }
}

/**
 * Hosted/desktop web: coalesce Firehose notifies onto animation frames so a
 * feed stampede cannot take every frame from chat, Command-K, or resize.
 */
export function enableUiYield(): void {
  coalesceEnabled = true;
}

export function isUiYieldEnabled(): boolean {
  return coalesceEnabled;
}

export function setUiYieldReason(reason: UiYieldReason, active: boolean): void {
  if (active) {
    reasons.add(reason);
    if (reason === "pointer" && pointerStartedAt === 0) pointerStartedAt = Date.now();
  } else {
    reasons.delete(reason);
    if (reason === "pointer") pointerStartedAt = 0;
    if (reasons.size === 0) lastInteractionAt = Date.now();
  }
  scheduleYieldPump();
}

export function noteUiInteraction(): void {
  lastInteractionAt = Date.now();
  scheduleYieldPump();
}

export function whenUiQuiet(): Promise<void> {
  if (!shouldYieldToUi()) return Promise.resolve();
  return new Promise((resolve) => {
    waiters.push(resolve);
  });
}

export function subscribeUiYield(listener: YieldListener): () => void {
  listeners.add(listener);
  listener(shouldYieldToUi());
  return () => {
    listeners.delete(listener);
  };
}

export function resetUiYieldForTests(): void {
  reasons.clear();
  lastInteractionAt = 0;
  pointerStartedAt = 0;
  lastYielding = false;
  clearQuietTimer();
  waiters = [];
  listeners.clear();
  coalesceEnabled = false;
}
