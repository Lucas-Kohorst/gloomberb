import { apiClient } from "../../../../api-client";
import { needsEmailVerification, resolvePlanAccess } from "../../shared/plan-access";

/** The signed-in cloud session, using the same plan rules as the rest of the app. */
export function teamSessionAccess() {
  return resolvePlanAccess(apiClient.getCurrentUser(), Date.now(), {
    hasCredential: apiClient.isSignedIn(),
  });
}

/**
 * Signed in far enough to open teams. A paying session is enough on its own:
 * the cached user can drop `emailVerified` without the account becoming free.
 */
export function teamSessionReady(): boolean {
  const access = teamSessionAccess();
  return access.signedIn && access.accountKnown && !needsEmailVerification(access);
}
