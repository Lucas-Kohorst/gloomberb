import { requestCloud } from "./cloud-request";

/** Stored implied-volatility routes live under `/cloud/iv/`. `path` is the query the pane client builds. */
export function impliedVolatility<T>(path: string, init?: RequestInit): Promise<T> {
  return requestCloud<T>(`/cloud/iv/${path}`, init);
}
