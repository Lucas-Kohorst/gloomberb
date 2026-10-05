import { apiClient } from "../../../api-client";
import { ApiRequestError, isAccessDenied } from "../../../api-client/errors";
import { resolvePlanAccess } from "../../../api-client/plan-access";
import type { QueryEntry } from "../../../market-data/result-types";
import { isCloudSessionRequired } from "./research-cloud-session";

/**
 * Whether a prefetched research tab has something to show.
 * An empty or missing dataset hides the tab. A sign-in wall, an upgrade
 * wall, or a failure the tab can retry stays visible.
 */
export async function shownIf<T>(
  load: () => Promise<T>,
  present: (value: T) => boolean,
  absent?: (error: unknown) => boolean,
): Promise<boolean> {
  try {
    return present(await load());
  } catch (error) {
    if (absent?.(error)) return false;
    if (error instanceof ApiRequestError && error.status === 404) return false;
    return true;
  }
}

export function isResearchAccessError(error: unknown): boolean {
  if (isAccessDenied(error)) return true;
  if (error instanceof ApiRequestError && error.status === 402) return true;
  return isCloudSessionRequired(error instanceof Error ? error.message : String(error));
}

/** The cache key research panes build from the session and plan. */
export function researchAccessKey(): string {
  const user = apiClient.getCurrentUser();
  const access = resolvePlanAccess(user);
  const requestKey = JSON.stringify([user?.id ?? null, access.emailVerified]);
  return `${requestKey}:${access.hasProAccess ? "full" : "preview"}`;
}

export function researchIsPro(): boolean {
  return resolvePlanAccess(apiClient.getCurrentUser()).hasProAccess;
}

/** The pane shows a sign-in or upgrade wall and does not fetch. */
export function researchCanReadPro(): boolean {
  const access = resolvePlanAccess(apiClient.getCurrentUser());
  return access.signedIn && access.emailVerified && access.hasProAccess;
}

/** Diagnostic starts a report once the account is verified, including on the free plan. */
export function researchEmailVerified(): boolean {
  return resolvePlanAccess(apiClient.getCurrentUser()).emailVerified;
}

/**
 * A coordinator entry has data when its payload passes `present`.
 * `NO_DATA` / `NOT_FOUND` hides the tab; any other failure keeps it.
 */
export function entryShows<T>(entry: QueryEntry<T>, present: (data: T) => boolean): boolean {
  if (entry.data && present(entry.data)) return true;
  if (isCloudSessionRequired(entry.error?.message)) return true;
  if (entry.error && entry.error.reasonCode !== "NO_DATA" && entry.error.reasonCode !== "NOT_FOUND") return true;
  return false;
}
