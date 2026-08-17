import type { PersistedAuthUser } from "../../../api-client";
import { createDefaultConfig } from "../../../types/config";
import type { ElectrobunBackendInit } from "../shared/protocol";

/**
 * The hosted client resolves its session and its backend init snapshot before
 * the first render. Both round-trip through the Worker to Gloom Cloud, so
 * without a ceiling a slow upstream is indistinguishable from a dead app: the
 * loading placeholder stays on screen with no error and no way forward.
 *
 * Every await here is therefore bounded and has a local fallback. Booting
 * degraded — signed-out banner, config restored from local storage — is always
 * better than not booting.
 */
/**
 * Both budgets sit above the Worker's own 8s upstream ceiling so the Worker's
 * answer wins whenever it produces one; these only fire when the Worker itself
 * stops responding.
 */
export const HOSTED_SESSION_BUDGET_MS = 12_000;
export const HOSTED_INIT_BUDGET_MS = 15_000;

export interface HostedSessionResult {
  user: PersistedAuthUser | null;
  /** The session could not be confirmed, so the user may in fact be signed in. */
  degraded: boolean;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<{
  json: () => Promise<unknown>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

/**
 * Ask the Worker who is signed in, giving up after `budgetMs`. A timeout or
 * transport error resolves to a degraded result rather than rejecting, so boot
 * continues either way.
 */
export async function resolveHostedSession(
  fetchImpl: FetchLike,
  budgetMs = HOSTED_SESSION_BUDGET_MS,
): Promise<HostedSessionResult> {
  const controller = new AbortController();
  // The deadline is raced rather than left to the abort signal alone: aborting
  // asks the transport to stop, but boot must not depend on it obliging.
  const expired = Symbol("expired");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof expired>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(expired);
    }, budgetMs);
  });
  try {
    const body = await Promise.race([
      (async () => {
        const response = await fetchImpl("/api/auth/session", {
          credentials: "include",
          signal: controller.signal,
        });
        return await response.json();
      })(),
      deadline,
    ]);
    if (body === expired || !isRecord(body)) return { user: null, degraded: true };
    const user = isRecord(body.user) && typeof body.user.id === "string"
      ? body.user as PersistedAuthUser
      : null;
    return { user, degraded: body.degraded === true };
  } catch {
    return { user: null, degraded: true };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Mirror of the Worker's hosted `init` response, used when the real one does
 * not arrive in time. The hosted snapshot is derived purely from the user id,
 * so this reproduces it exactly rather than guessing.
 */
export function createHostedFallbackInit(options: {
  userId: string | null;
  windowKind: "main" | "detached";
  paneId?: string;
}): ElectrobunBackendInit {
  const config = createDefaultConfig(`cloud://users/${options.userId ?? "anonymous"}`);
  if (options.userId) config.onboardingComplete = true;
  return {
    config,
    sessionSnapshot: null,
    desktopSnapshot: null,
    desktopThemePreview: null,
    pluginState: {},
    capabilityManifests: [],
    desktopPlatform: "cloud",
    windowKind: options.windowKind,
    paneId: options.paneId,
  };
}

export interface HostedInitResult {
  init: ElectrobunBackendInit;
  /** True when the backend never answered and the fallback snapshot is in use. */
  degraded: boolean;
}

/**
 * Run the backend init RPC under a deadline, falling back to a locally built
 * snapshot. The user's own layout still comes back afterwards because hosted
 * config is overlaid from local storage on top of whichever snapshot is used.
 */
export async function resolveHostedInit(
  requestInit: () => Promise<ElectrobunBackendInit>,
  fallback: () => ElectrobunBackendInit,
  budgetMs = HOSTED_INIT_BUDGET_MS,
): Promise<HostedInitResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), budgetMs);
  });
  try {
    const init = await Promise.race([requestInit(), expired]);
    if (init) return { init, degraded: false };
    return { init: fallback(), degraded: true };
  } catch {
    return { init: fallback(), degraded: true };
  } finally {
    clearTimeout(timer);
  }
}
