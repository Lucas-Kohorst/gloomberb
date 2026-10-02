import { apiClient } from "../../../api-client";
import { usePlanAccess } from "../shared/plan-access";

/** Account identity for screen queries. A changed user drops the previous snapshot. */
export function useEquityScreenerSession() {
  const access = usePlanAccess();
  const requestKey = JSON.stringify([
    apiClient.getCurrentUser()?.id ?? null,
    access.emailVerified,
  ]);
  return {
    access,
    requestKey,
    needsVerification: access.signedIn && !access.emailVerified,
  };
}
