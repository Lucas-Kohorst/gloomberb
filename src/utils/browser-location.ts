/**
 * Browser detection that survives the terminal runtime.
 *
 * `@opentui/core` installs a bare `global.window = {}` so DOM-shaped libraries
 * can load under Bun. That makes the usual `typeof window !== "undefined"`
 * guard true in a terminal where no DOM API exists, so reading
 * `window.location.pathname` behind that guard throws — and when it happens
 * during app bootstrap it takes the whole TUI down before it paints.
 *
 * Feature-detect the capability instead of the `window` binding. Each helper
 * validates every member of the type it hands back, so a caller can use the
 * result without re-checking.
 */

/**
 * The subset of `Location` this app reads. `pathname` and `search` are what
 * the detection helpers destructure, so they are guaranteed. `protocol` and
 * `origin` stay optional rather than gating the whole check on members only
 * one caller needs.
 */
export interface BrowserLocation {
  readonly pathname: string;
  readonly search: string;
  readonly protocol?: string;
  readonly origin?: string;
}

/** The subset of `Window` this app reaches for outside the DOM renderers. */
export interface BrowserWindow {
  readonly location: BrowserLocation;
  readonly history: { replaceState(data: unknown, unused: string, url?: string): void };
  dispatchEvent(event: Event): boolean;
}

function windowCandidate(): Record<string, unknown> | undefined {
  const candidate = (globalThis as { window?: unknown }).window;
  return typeof candidate === "object" && candidate !== null
    ? (candidate as Record<string, unknown>)
    : undefined;
}

function asLocation(value: unknown): BrowserLocation | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const usable = typeof record.pathname === "string" && typeof record.search === "string";
  return usable ? (value as BrowserLocation) : null;
}

/**
 * The current browser location, or null when running under the terminal shim.
 */
export function getBrowserLocation(): BrowserLocation | null {
  return asLocation(windowCandidate()?.location);
}

/**
 * The browser window, or null when running under the terminal shim.
 */
export function getBrowserWindow(): BrowserWindow | null {
  const candidate = windowCandidate();
  if (!candidate) return null;
  if (!asLocation(candidate.location)) return null;
  if (typeof candidate.dispatchEvent !== "function") return null;
  const history = candidate.history as { replaceState?: unknown } | undefined;
  if (typeof history?.replaceState !== "function") return null;
  return candidate as unknown as BrowserWindow;
}
