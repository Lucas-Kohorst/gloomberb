import { reportConnectionRequest } from "../plugins/builtin/connections/register";

export const SHARE_CONNECTION_ID = "gloom-sharing";

type ShareFetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function fetchShare(fetchImpl: ShareFetch, input: string, init?: RequestInit): Promise<Response> {
  const start = Date.now();
  const operation = init?.method ?? "GET";
  try {
    const response = await fetchImpl(input, init);
    reportConnectionRequest(SHARE_CONNECTION_ID, {
      success: response.ok,
      durationMs: Date.now() - start,
      operation,
      ...(!response.ok ? { error: `HTTP ${response.status}` } : {}),
    });
    return response;
  } catch (error) {
    reportConnectionRequest(SHARE_CONNECTION_ID, {
      success: false,
      durationMs: Date.now() - start,
      operation,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
