import { useSyncExternalStore } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

type MediaQueryListLike = Pick<MediaQueryList, "matches" | "addEventListener" | "removeEventListener">;

/** The OpenTUI renderer has no `matchMedia`; it reports no preference there. */
function getReducedMotionQuery(): MediaQueryListLike | null {
  const matchMedia = (globalThis as { matchMedia?: (query: string) => MediaQueryListLike }).matchMedia;
  if (typeof matchMedia !== "function") return null;
  try {
    return matchMedia.call(globalThis, REDUCED_MOTION_QUERY);
  } catch {
    return null;
  }
}

export function prefersReducedMotion(): boolean {
  return getReducedMotionQuery()?.matches === true;
}

function subscribe(onChange: () => void): () => void {
  const query = getReducedMotionQuery();
  if (!query || typeof query.addEventListener !== "function") return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}
