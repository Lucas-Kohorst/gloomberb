/** Returns `localStorage` when available; null in non-browser or restricted contexts. */
export function tryLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}
