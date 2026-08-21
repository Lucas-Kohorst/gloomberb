import type { AppSessionSnapshot } from "../../core/state/session-persistence";
import { isRecord } from "../../utils/is-record";
import { tryLocalStorage } from "../../utils/browser-storage";
import { resolveHostedPersistUserId } from "./hosted-user-persist";

const STORAGE_PREFIX = "gloomberb:hosted-session:";

export function hostedSessionStorageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

function parseSessionSnapshot(raw: string | null): AppSessionSnapshot | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.paneState)) return null;
    const activePanel = parsed.activePanel === "right" ? "right" : "left";
    return {
      paneState: parsed.paneState as AppSessionSnapshot["paneState"],
      focusedPaneId: typeof parsed.focusedPaneId === "string" ? parsed.focusedPaneId : null,
      activePanel,
      statusBarVisible: parsed.statusBarVisible !== false,
      openPaneIds: Array.isArray(parsed.openPaneIds)
        ? parsed.openPaneIds.filter((id): id is string => typeof id === "string")
        : [],
      hydrationTargets: Array.isArray(parsed.hydrationTargets) ? parsed.hydrationTargets as AppSessionSnapshot["hydrationTargets"] : [],
      exchangeCurrencies: Array.isArray(parsed.exchangeCurrencies)
        ? parsed.exchangeCurrencies.filter((id): id is string => typeof id === "string")
        : [],
      savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function readHostedSessionSnapshot(
  userId = resolveHostedPersistUserId(),
): AppSessionSnapshot | null {
  if (!userId) return null;
  const backend = tryLocalStorage();
  if (!backend) return null;
  try {
    return parseSessionSnapshot(backend.getItem(hostedSessionStorageKey(userId)));
  } catch {
    return null;
  }
}

export function writeHostedSessionSnapshot(
  snapshot: AppSessionSnapshot | null,
  userId = resolveHostedPersistUserId(),
): void {
  if (!userId) return;
  const backend = tryLocalStorage();
  if (!backend) return;
  try {
    const key = hostedSessionStorageKey(userId);
    if (!snapshot) backend.removeItem(key);
    else backend.setItem(key, JSON.stringify(snapshot));
  } catch {
    // Ignore quota or security errors.
  }
}
