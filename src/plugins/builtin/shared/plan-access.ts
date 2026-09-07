import { useSyncExternalStore } from "react";
import { apiClient } from "../../../api-client";

/**
 * Minimum shape the plan helpers need. Both `AuthUser` (from `/auth/get-session`)
 * and `AccountProfile` (from `/account/profile`) satisfy it.
 */
export interface PlanAccessUser {
  emailVerified?: boolean;
  plan?: "free" | "pro" | null;
  /** Server-computed entitlement: "pro" while a trial runs or a subscription is active. */
  effectivePlan?: "free" | "pro" | null;
  /** ISO timestamp the free Pro trial ends; null once it lapsed or never started. */
  trialEndsAt?: string | null;
}

export interface PlanAccess {
  signedIn: boolean;
  /**
   * False while a session token exists but `/auth/get-session` has not filled
   * the user yet. Upgrade CTAs must not fire in that window — a paying sub
   * looks signed-out if we only inspect `user`.
   */
  accountKnown: boolean;
  /** Signed in *and* verified, i.e. account-gated cloud features will answer. */
  emailVerified: boolean;
  /** Real-time entitlement right now: paying subscriber or an active trial. */
  hasProAccess: boolean;
  /** Paying subscriber, i.e. an upgrade CTA is no longer relevant. */
  isPayingPro: boolean;
  isTrialActive: boolean;
  /** Whole days remaining, rounded up; 1 on the final day, 0 when no trial runs. */
  trialDaysLeft: number;
  trialEndsAt: Date | null;
}

/** Delay the cloud applies to free-tier equity and options quotes. */
export const CLOUD_QUOTE_DELAY_MINUTES = 15;
/** Delay the cloud applies to free-tier news wire articles. */
export const CLOUD_NEWS_DELAY_HOURS = 12;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function resolveTrialEndsAt(user: PlanAccessUser | null | undefined): Date | null {
  if (!user?.trialEndsAt) return null;
  const endsAt = new Date(user.trialEndsAt);
  return Number.isNaN(endsAt.getTime()) ? null : endsAt;
}

export function isTrialActive(user: PlanAccessUser | null | undefined, now = Date.now()): boolean {
  if (user?.emailVerified !== true) return false;
  // Card-backed trials run as plan "pro" with a trialing subscription; the server
  // only sends `trialEndsAt` while the subscription is actually in its trial.
  const endsAt = resolveTrialEndsAt(user);
  return !!endsAt && endsAt.getTime() > now;
}

export function trialDaysLeft(user: PlanAccessUser | null | undefined, now = Date.now()): number {
  const endsAt = resolveTrialEndsAt(user);
  if (!endsAt) return 0;
  const remainingMs = endsAt.getTime() - now;
  if (remainingMs <= 0) return 0;
  return Math.max(1, Math.ceil(remainingMs / MS_PER_DAY));
}

/**
 * Whether the account is entitled to real-time cloud data. `effectivePlan` is the
 * server's answer, but the trial clock is re-checked locally so a session captured
 * before the trial lapsed cannot keep claiming Pro. Sessions from older servers
 * (no `effectivePlan`) fall back to the legacy verified-and-paid check.
 */
export function hasProAccess(user: PlanAccessUser | null | undefined, now = Date.now()): boolean {
  // A stored Pro entitlement is enough: a stale cache that dropped
  // `emailVerified` must not paint upgrade/sign-up over a paying session.
  if (user?.plan === "pro") return true;
  if (user?.effectivePlan === "pro" && !user.trialEndsAt) return true;
  if (user?.emailVerified !== true) return false;
  if (isTrialActive(user, now)) return true;
  return false;
}

export function resolvePlanAccess(
  user: PlanAccessUser | null | undefined,
  now = Date.now(),
  session: { hasCredential?: boolean } = {},
): PlanAccess {
  const trialActive = isTrialActive(user, now);
  const signedIn = !!user || session.hasCredential === true;
  return {
    signedIn,
    accountKnown: !signedIn || !!user,
    emailVerified: user?.emailVerified === true,
    hasProAccess: hasProAccess(user, now),
    isPayingPro: hasProAccess(user, now) && !trialActive,
    isTrialActive: trialActive,
    trialDaysLeft: trialActive ? trialDaysLeft(user, now) : 0,
    trialEndsAt: resolveTrialEndsAt(user),
  };
}

function planAccessKey(): string {
  const user = apiClient.getCurrentUser();
  const signed = apiClient.isSignedIn() ? "in" : "out";
  if (!user) return `${signed}:anonymous`;
  return [
    signed,
    user.id,
    user.emailVerified === true ? "verified" : "unverified",
    user.plan ?? "",
    user.effectivePlan ?? "",
    user.trialEndsAt ?? "",
  ].join(":");
}

/**
 * True when a verify-email wall should show. Never while the session is still
 * hydrating, and never for an entitled Pro session whose cache dropped the flag.
 */
export function needsEmailVerification(
  access: PlanAccess,
  failureStatus?: number,
): boolean {
  if (!access.signedIn || !access.accountKnown || access.hasProAccess) return false;
  if (failureStatus === 401) return false;
  return access.emailVerified !== true || failureStatus === 403;
}

/**
 * Whether the session can run cloud search: a verified email is the minimum,
 * and Pro entitlement is enough on its own (a Pro session's cache may drop the
 * verification flag). Shared by the research-search pane's search and saved-
 * search paths so the gate cannot drift apart.
 */
export function canUseCloudSearch(access: PlanAccess): boolean {
  return access.emailVerified || access.hasProAccess;
}

/** Plan state of the signed-in cloud session, refreshed whenever the session changes. */
export function usePlanAccess(): PlanAccess {
  useSyncExternalStore(
    (onChange) => apiClient.subscribeCurrentUser(onChange),
    planAccessKey,
    planAccessKey,
  );
  return resolvePlanAccess(apiClient.getCurrentUser(), Date.now(), {
    hasCredential: apiClient.isSignedIn(),
  });
}
