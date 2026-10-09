import { useCallback, useEffect, useRef, useState } from "react";
import { EdgarFilingsClient, appendFilings, applyLatestFilings } from "./client";
import type { EdgarFiling } from "./types";

export interface EdgarFilingsStream {
  rows: EdgarFiling[];
  loading: boolean;
  loadingMore: boolean;
  error: Error | null;
  moreError: Error | null;
  hasMore: boolean;
  updatedAt: number | null;
  loadMore: () => void;
  reload: () => void;
}

interface StreamState {
  form: string;
  rows: EdgarFiling[];
  nextOffset: number;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: Error | null;
  moreError: Error | null;
  updatedAt: number | null;
}

const EMPTY: EdgarFiling[] = [];

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

function aborted(cause: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (cause instanceof Error && cause.name === "AbortError");
}

/**
 * The latest page, refreshed in place, with older pages kept underneath.
 * A new form starts over: the previous form's rows are not part of this one.
 */
export function useEdgarFilings(form: string, enabled = true): EdgarFilingsStream {
  const clientRef = useRef<EdgarFilingsClient | null>(null);
  if (!clientRef.current) clientRef.current = new EdgarFilingsClient();
  const client = clientRef.current;
  const [state, setState] = useState<StreamState>({
    form,
    rows: EMPTY,
    nextOffset: 0,
    hasMore: false,
    loading: true,
    loadingMore: false,
    error: null,
    moreError: null,
    updatedAt: null,
  });
  const latestRef = useRef<AbortController | null>(null);
  const moreRef = useRef<AbortController | null>(null);
  const rowsRef = useRef(state.rows);
  const nextOffsetRef = useRef(state.nextOffset);
  const hasMoreRef = useRef(state.hasMore);
  rowsRef.current = state.rows;
  nextOffsetRef.current = state.nextOffset;
  hasMoreRef.current = state.hasMore;
  // The effect sets this before the first fetch of a form, so that fetch
  // replaces the list instead of merging it onto the previous form.
  const replaceRef = useRef(true);
  const rowsFormRef = useRef<string | null>(null);

  const loadLatest = useCallback(async () => {
    if (!enabled) return;
    latestRef.current?.abort();
    moreRef.current?.abort();
    moreRef.current = null;
    const controller = new AbortController();
    latestRef.current = controller;
    // A refresh merges onto this form's rows. A new form, or a refresh that
    // landed before those rows existed, replaces them.
    const replace = replaceRef.current || rowsFormRef.current !== form;
    replaceRef.current = false;
    if (replace) {
      hasMoreRef.current = false;
      nextOffsetRef.current = 0;
    }
    setState((current) => ({ ...current, loading: true, loadingMore: false, error: null, moreError: null }));
    try {
      const page = await client.latestFilings({ form, offset: 0, signal: controller.signal });
      if (latestRef.current !== controller) return;
      latestRef.current = null;
      const applied = applyLatestFilings(replace ? EMPTY : rowsRef.current, page.rows);
      const rewind = replace || applied.reset;
      const nextOffset = rewind ? (page.nextOffset ?? page.rows.length) : nextOffsetRef.current;
      const hasMore = rewind ? page.hasMore : hasMoreRef.current;
      rowsRef.current = applied.rows;
      rowsFormRef.current = form;
      nextOffsetRef.current = nextOffset;
      hasMoreRef.current = hasMore;
      setState({
        form,
        rows: applied.rows,
        nextOffset,
        hasMore,
        loading: false,
        loadingMore: false,
        error: null,
        moreError: null,
        updatedAt: Date.now(),
      });
    } catch (cause) {
      if (latestRef.current !== controller || aborted(cause, controller.signal)) return;
      latestRef.current = null;
      if (replace) {
        rowsRef.current = EMPTY;
        rowsFormRef.current = form;
      }
      setState((current) => ({
        ...current,
        form,
        rows: replace ? EMPTY : current.rows,
        loading: false,
        error: toError(cause),
      }));
    }
  }, [client, enabled, form]);

  useEffect(() => {
    if (!enabled) {
      latestRef.current?.abort();
      latestRef.current = null;
      moreRef.current?.abort();
      moreRef.current = null;
      return;
    }
    replaceRef.current = true;
    void loadLatest();
    return () => {
      latestRef.current?.abort();
      latestRef.current = null;
      moreRef.current?.abort();
      moreRef.current = null;
    };
  }, [enabled, loadLatest]);

  const loadMore = useCallback(() => {
    if (!enabled || rowsFormRef.current !== form || !hasMoreRef.current || latestRef.current || moreRef.current) return;
    const controller = new AbortController();
    moreRef.current = controller;
    const offset = nextOffsetRef.current;
    setState((current) => ({ ...current, loadingMore: true, moreError: null }));
    void (async () => {
      try {
        const page = await client.latestFilings({ form, offset, signal: controller.signal });
        if (moreRef.current !== controller) return;
        moreRef.current = null;
        const rows = appendFilings(rowsRef.current, page.rows);
        const nextOffset = page.nextOffset ?? offset + page.rows.length;
        rowsRef.current = rows;
        nextOffsetRef.current = nextOffset;
        hasMoreRef.current = page.hasMore;
        setState((current) => ({
          ...current,
          rows,
          nextOffset,
          hasMore: page.hasMore,
          loadingMore: false,
        }));
      } catch (cause) {
        if (moreRef.current !== controller || aborted(cause, controller.signal)) return;
        moreRef.current = null;
        setState((current) => ({ ...current, loadingMore: false, moreError: toError(cause) }));
      }
    })();
  }, [client, enabled, form]);

  const reload = useCallback(() => {
    void loadLatest();
  }, [loadLatest]);

  if (!enabled) {
    return {
      rows: EMPTY,
      loading: false,
      loadingMore: false,
      error: null,
      moreError: null,
      hasMore: false,
      updatedAt: null,
      loadMore: () => {},
      reload: () => {},
    };
  }

  const current = state.form === form;
  return {
    rows: current ? state.rows : EMPTY,
    loading: current ? state.loading : true,
    loadingMore: current ? state.loadingMore : false,
    error: current ? state.error : null,
    moreError: current ? state.moreError : null,
    hasMore: current ? state.hasMore : false,
    updatedAt: current ? state.updatedAt : null,
    loadMore,
    reload,
  };
}
