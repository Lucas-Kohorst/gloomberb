import type { SubstackArticleDetail } from "./types";

export interface LoadState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  fetchedAt: number | null;
  stale: boolean;
}

export type DetailState = LoadState<SubstackArticleDetail>;

export function emptyLoadState<T>(): LoadState<T> {
  return {
    data: null,
    loading: false,
    error: null,
    fetchedAt: null,
    stale: false,
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
