import { apiClient } from "./index";

type CloudRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

/** Authenticated Gloom Cloud GET/POST without adding methods to the shared client. */
export function requestCloud<T>(path: string, init?: RequestInit): Promise<T> {
  const client = apiClient as unknown as { request: CloudRequest };
  return client.request(path, init);
}
