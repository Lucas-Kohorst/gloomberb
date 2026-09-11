import { flushPendingPersistence } from "../../../state/persist-scheduler";

export function installPersistenceLifecycle(
  page: EventTarget,
  document: EventTarget & { readonly visibilityState: string },
): () => void {
  const flush = () => { void flushPendingPersistence(); };
  const visibilityChanged = () => {
    if (document.visibilityState === "hidden") flush();
  };
  page.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", visibilityChanged);
  return () => {
    page.removeEventListener("pagehide", flush);
    document.removeEventListener("visibilitychange", visibilityChanged);
  };
}
