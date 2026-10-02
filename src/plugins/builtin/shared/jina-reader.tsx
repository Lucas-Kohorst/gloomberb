import { useCallback, useEffect, useRef, useState } from "react";
import { Box, ScrollBox, Text, type ScrollBoxRenderable } from "../../../ui";
import { EmptyState, Spinner } from "../../../components";
import { ArticleContent } from "../../../components/article-content";
import { withConnectionRequest } from "../connections/register";
import { colors } from "../../../theme/colors";
import { httpFetch } from "../../../utils/http-transport";
import {
  cleanJinaArticle,
  classifyReaderHttpFailure,
  classifyReaderThrow,
  preferredArticleBody,
  readableArticleText,
  readerFallbackNotice,
  type ReaderFailureKind,
  JINA_READER_ENDPOINT,
  JINA_READER_HEADERS,
} from "./jina-article-text";

const JINA_CONNECTION_ID = "jina-ai";

export interface JinaArticleState {
  content: string | null;
  loading: boolean;
  /** Short footer status when extraction failed; null when ok. */
  error: string | null;
  /** Body explanation for empty-pane failures (not duplicated in the footer). */
  failureMessage: string | null;
  failureKind: ReaderFailureKind | null;
}

const EMPTY_STATE: JinaArticleState = {
  content: null,
  loading: false,
  error: null,
  failureMessage: null,
  failureKind: null,
};

export function useJinaArticle(url: string, enabled = true) {
  const target = url.trim();
  const [state, setState] = useState({ ...EMPTY_STATE, url: target });
  const requestRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    const requestId = ++requestRef.current;
    abortRef.current?.abort();
    if (!target) {
      setState({
        ...EMPTY_STATE,
        url: target,
        error: "no article url",
        failureMessage: "No article URL available.",
        failureKind: "unknown",
      });
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      setState({
        ...EMPTY_STATE,
        url: target,
        error: "invalid url",
        failureMessage: "Article URL is invalid.",
        failureKind: "unknown",
      });
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      setState({
        ...EMPTY_STATE,
        url: target,
        error: "invalid url",
        failureMessage: "Article URL must use HTTP or HTTPS.",
        failureKind: "unknown",
      });
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setState((current) => ({
      ...(current.url === target ? current : EMPTY_STATE),
      url: target,
      loading: true,
      error: null,
      failureMessage: null,
      failureKind: null,
    }));
    void withConnectionRequest(JINA_CONNECTION_ID, "render article", async () => {
      const response = await httpFetch(`${JINA_READER_ENDPOINT}${target}`, {
        signal: controller.signal,
        headers: JINA_READER_HEADERS,
      });
      const raw = await response.text();
      if (!response.ok) {
        const failure = classifyReaderHttpFailure(response.status, raw);
        throw Object.assign(new Error(failure.status), { readerFailure: failure });
      }
      return raw;
    }).then((content) => {
      if (requestRef.current !== requestId) return;
      setState({
        url: target,
        content: cleanJinaArticle(content),
        loading: false,
        error: null,
        failureMessage: null,
        failureKind: null,
      });
    }).catch((error: unknown) => {
      if (requestRef.current !== requestId || controller.signal.aborted) return;
      const failure = classifyReaderThrow(error);
      setState((current) => ({
        ...current,
        loading: false,
        // Keep any previously extracted content; failure only clears on a new url.
        error: failure.status,
        failureMessage: failure.message,
        failureKind: failure.kind,
      }));
    });
    return () => controller.abort();
  }, [target]);

  useEffect(() => {
    if (enabled) refresh();
    else setState((current) => current.loading ? { ...current, loading: false } : current);
    return () => {
      requestRef.current += 1;
      abortRef.current?.abort();
    };
  }, [enabled, refresh]);

  const current = state.url === target ? state : { ...EMPTY_STATE, loading: enabled };
  return { ...current, refresh };
}

export function JinaArticleReader({
  title,
  url,
  width,
  height,
  focused,
  state,
  knownBody = "",
  metadata = [],
}: {
  title: string;
  url: string;
  width: number;
  height: number;
  focused: boolean;
  state: JinaArticleState;
  /** Body the payload already carried (Substack post text, wire summary). */
  knownBody?: string;
  metadata?: readonly string[];
}) {
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const lineWidth = Math.max(1, width - 4);
  const body = preferredArticleBody(readableArticleText(knownBody), state.content);
  const notice = readerFallbackNotice(state.failureKind, !!body.trim());

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [url]);

  if (!url && !body) {
    return <EmptyState title={title || "Article unavailable."} message="This article has no source URL." />;
  }
  if (state.loading && !body) {
    return (
      <Box flexDirection="column" width={width} height={height} justifyContent="center" alignItems="center">
        <Spinner label="Rendering article..." />
      </Box>
    );
  }

  if (!body && state.failureMessage && !state.loading) {
    return (
      <Box flexDirection="column" width={width} height={height} padding={1}>
        <EmptyState
          title="Full text unavailable."
          message={state.failureMessage}
          hint={url ? "Press o to open the source, or r to retry." : undefined}
        />
      </Box>
    );
  }

  return (
    <ScrollBox ref={scrollRef} scrollY focusable={focused} flexGrow={1} paddingX={1}>
      <Box flexDirection="column" width={lineWidth} gap={1}>
        {state.loading ? <Text fg={colors.textDim}>Refreshing article...</Text> : null}
        {notice ? (
          <Text fg={colors.warning} wrapText width={lineWidth}>{notice}</Text>
        ) : null}
        {body ? (
          <ArticleContent body={body} metadata={metadata} width={lineWidth} />
        ) : !state.error ? <Text fg={colors.textDim}>No article text returned.</Text> : null}
      </Box>
    </ScrollBox>
  );
}
