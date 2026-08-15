import type { DesktopBackendRequestPayload, DesktopHttpFetchResponse } from "../../shared/protocol";
import { handleHttpFetch as handleSharedHttpFetch } from "../../shared/http-fetch";

export function handleHttpFetch(
  payload: DesktopBackendRequestPayload<"http.fetch">,
): Promise<DesktopHttpFetchResponse> {
  return handleSharedHttpFetch(payload);
}
