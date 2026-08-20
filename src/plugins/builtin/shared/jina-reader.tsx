import { useCallback, useEffect, useRef, useState } from "react";
import { Box, ScrollBox, Text, type ScrollBoxRenderable } from "../../../ui";
import { EmptyState, Spinner } from "../../../components";
import { MarkdownText } from "../../../components/markdown-text";
import { withConnectionRequest } from "../connections/register";
import { colors } from "../../../theme/colors";
import { httpFetch } from "../../../utils/http-transport";
import {
  cleanJinaArticle,
  classifyReaderHttpFailure,
  classifyReaderThrow,
  preferredArticleBody,
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
  const [state, setState] = useState<JinaArticleState>(EMPTY_STATE);
  const requestRef = useRef(0);

  const refresh = useCallback(() => {
    const target = url.trim();
    if (!target) {
      setState({
        ...EMPTY_STATE,
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
        error: "invalid url",
        failureMessage: "Article URL is invalid.",
        failureKind: "unknown",
      });
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      setState({
        ...EMPTY_STATE,
        error: "invalid url",
        failureMessage: "Article URL must use HTTP or HTTPS.",
        failureKind: "unknown",
      });
      return;
    }

    requestRef.current += 1;
    const requestId = requestRef.current;
    const controller = new AbortController();
    setState((current) => ({
      ...current,
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
  }, [url]);

  useEffect(() => {
    if (!enabled) return;
    return refresh();
  }, [enabled, refresh]);

  return { ...state, refresh };
}

export function JinaArticleReader({
  title,
  url,
  width,
  height,
  focused,
  state,
  knownBody = "",
}: {
  title: string;
  url: string;
  width: number;
  height: number;
  focused: boolean;
  state: JinaArticleState;
  /** Body the payload already carried (Substack post text, wire summary). */
  knownBody?: string;
}) {
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const lineWidth = Math.max(1, width - 4);
  const body = preferredArticleBody(knownBody, state.content);
  const notice = readerFallbackNotice(state.failureKind, !!body.trim());

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [url, state.content, state.failureKind]);

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
          <MarkdownText text={body} lineWidth={lineWidth} textColor={colors.text} />
        ) : !state.error ? <Text fg={colors.textDim}>No article text returned.</Text> : null}
      </Box>
    </ScrollBox>
  );
}
