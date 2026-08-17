import { useCallback, useEffect, useRef, useState } from "react";
import { Box, ScrollBox, Text, TextAttributes, type ScrollBoxRenderable } from "../../../ui";
import { EmptyState, Spinner } from "../../../components";
import { MarkdownText } from "../../../components/markdown-text";
import { withConnectionRequest } from "../connections/register";
import { colors } from "../../../theme/colors";

const JINA_CONNECTION_ID = "jina-ai";

export interface JinaArticleState {
  content: string | null;
  loading: boolean;
  error: string | null;
}

export function useJinaArticle(url: string, enabled = true) {
  const [state, setState] = useState<JinaArticleState>({
    content: null,
    loading: false,
    error: null,
  });
  const requestRef = useRef(0);

  const refresh = useCallback(() => {
    const target = url.trim();
    if (!target) {
      setState({ content: null, loading: false, error: "No article URL available." });
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      setState({ content: null, loading: false, error: "Article URL is invalid." });
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      setState({ content: null, loading: false, error: "Article URL must use HTTP or HTTPS." });
      return;
    }

    requestRef.current += 1;
    const requestId = requestRef.current;
    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true, error: null }));
    void withConnectionRequest(JINA_CONNECTION_ID, "render article", async () => {
      const response = await fetch(`https://r.jina.ai/${target}`, {
        signal: controller.signal,
        headers: { Accept: "text/plain" },
      });
      if (!response.ok) throw new Error(`Reader request failed (${response.status})`);
      return response.text();
    }).then((content) => {
      if (requestRef.current !== requestId) return;
      setState({ content: content.trim(), loading: false, error: null });
    }).catch((error: unknown) => {
      if (requestRef.current !== requestId || controller.signal.aborted) return;
      setState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
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
}: {
  title: string;
  url: string;
  width: number;
  height: number;
  focused: boolean;
  state: JinaArticleState;
}) {
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const lineWidth = Math.max(1, width - 4);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [url, state.content]);

  if (!url) {
    return <EmptyState title={title || "Article unavailable."} message="This article has no source URL." />;
  }
  if (state.loading && !state.content) {
    return (
      <Box flexDirection="column" width={width} height={height} justifyContent="center" alignItems="center">
        <Spinner label="Rendering article..." />
      </Box>
    );
  }

  return (
    <ScrollBox ref={scrollRef} scrollY focusable={focused} flexGrow={1} paddingX={1}>
      <Box flexDirection="column" width={lineWidth} gap={1}>
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD} wrapText width={lineWidth}>
          {title || "Article"}
        </Text>
        {state.loading ? <Text fg={colors.textDim}>Refreshing article...</Text> : null}
        {state.error ? <Text fg={colors.negative} wrapText width={lineWidth}>{state.error}</Text> : null}
        {state.content ? (
          <MarkdownText text={state.content} lineWidth={lineWidth} textColor={colors.text} />
        ) : !state.error ? <Text fg={colors.textDim}>No article text returned.</Text> : null}
      </Box>
    </ScrollBox>
  );
}
