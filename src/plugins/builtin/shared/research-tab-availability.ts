import { apiClient } from "../../../api-client";
import { ApiRequestError } from "../../../api-client/errors";
import { resolvePlanAccess } from "../../../api-client/plan-access";
import type { QueryEntry } from "../../../market-data/result-types";
import { isCloudSessionRequired } from "./research-cloud-session";

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

export function researchAccessKey(): string {
  const user = apiClient.getCurrentUser();
  const access = resolvePlanAccess(user);
  const requestKey = JSON.stringify([user?.id ?? null, access.emailVerified]);
  return `${requestKey}:${access.hasProAccess ? "full" : "preview"}`;
}

export function researchIsPro(): boolean {
  return resolvePlanAccess(apiClient.getCurrentUser()).hasProAccess;
}

export function researchCanReadPro(): boolean {
  const access = resolvePlanAccess(apiClient.getCurrentUser());
  return access.signedIn && access.emailVerified && access.hasProAccess;
}

export function researchEmailVerified(): boolean {
  return resolvePlanAccess(apiClient.getCurrentUser()).emailVerified;
}

export function entryShows<T>(entry: QueryEntry<T>, present: (data: T) => boolean): boolean {
  if (entry.data && present(entry.data)) return true;
  if (isCloudSessionRequired(entry.error?.message)) return true;
  if (entry.error && entry.error.reasonCode !== "NO_DATA" && entry.error.reasonCode !== "NOT_FOUND") return true;
  return false;
}
