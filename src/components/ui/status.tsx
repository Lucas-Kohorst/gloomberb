import type { ReactNode } from "react";
import { Box, Text } from "../../ui";
import { colors } from "../../theme/colors";
import { t, tf } from "../../i18n";

export interface EmptyStateProps {
  title: string;
  message?: string;
  hint?: string;
  /** Fill the parent and center the copy. Default true. */
  fill?: boolean;
}

export function EmptyState({ title, message, hint }: EmptyStateProps) {
  // A fixed one-cell height clipped long text at the pane edge with no marker,
  // so provider messages lost their tail. These rows own the pane body, so let
  // them wrap instead.
  return (
    <Box flexDirection="column">
      <Box>
        <Text fg={colors.textDim}>{t(title)}</Text>
      </Box>
      {message && (
        <Box>
          <Text fg={colors.textMuted}>{t(message)}</Text>
        </Box>
      )}
      {hint && (
        <Box>
          <Text fg={colors.textMuted}>{t(hint)}</Text>
        </Box>
      )}
    </Box>
  );
  if (!fill) return body;
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      flexBasis={0}
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
    >
      {body}
    </Box>
  );
}

export function LoadingState({ title = "Loading data..." }: { title?: string }) {
  return <EmptyState title={title} />;
}

/**
 * `hint` is opt-in on purpose: a retry hint must only appear where the pane
 * actually binds the key, so callers pass it rather than inherit a default.
 */
export function ErrorState({
  error,
  hint,
  kind,
}: {
  error: string | null | undefined;
  hint?: string;
  kind?: string;
}) {
  if (kind && isNoDataError(error)) {
    return <EmptyState title={noDataTitle(kind)} />;
  }
  if (kind) {
    return <EmptyState title={unavailableTitle(kind)} message={dataErrorMessage(error)} hint={hint} />;
  }
  return <EmptyState title={dataErrorMessage(error)} hint={hint} />;
}

/** Centered two-line empty copy for ticker-bound panes. */
export function TickerEmptyState({
  kind,
  symbol,
  detail,
  error,
}: {
  kind: string;
  symbol?: string | null;
  detail: string;
  error?: string | null;
}) {
  if (!symbol) {
    return (
      <EmptyState
        title="No ticker selected"
        message={`Select a ticker to view ${kind} data.`}
      />
    );
  }
  if (error && !isNoDataError(error)) {
    return <EmptyState title={unavailableTitle(kind)} message={dataErrorMessage(error)} />;
  }
  return <EmptyState title={noDataTitle(kind)} message={noDataMessage(symbol, detail)} />;
}

/** The one loading phrasing: "Loading ..." with three dots, never the ellipsis glyph. */
export function loadingText(thing?: string): string {
  return thing ? tf("Loading {thing}...", { thing }) : t("Loading...");
}

/** The one failure phrasing: "<Thing> unavailable." */
export function unavailableText(thing: string): string {
  return tf("{thing} unavailable.", { thing });
}

export interface PaneStatusBodyProps {
  loading?: boolean;
  error?: string | null;
  /** True when there is nothing to show and nothing is in flight. */
  empty?: boolean;
  /** Names what is being loaded or what failed, e.g. "movers". */
  subject?: string;
  emptyTitle?: string;
  emptyMessage?: string;
  children?: ReactNode;
}

/**
 * Standard loading/error/empty body for a pane. Returns `children` once there
 * is something to render, so a pane can wrap its content in one place instead
 * of hand-rolling three near-identical states.
 */
export function PaneStatusBody({
  loading = false,
  error,
  empty = false,
  subject,
  emptyTitle,
  emptyMessage,
  children,
}: PaneStatusBodyProps) {
  if (error) {
    return (
      <Box paddingX={1} paddingY={1}>
        <EmptyState
          title={subject ? unavailableText(subject) : error}
          message={subject ? error : undefined}
        />
      </Box>
    );
  }
  if (loading) {
    // The screenshot renderer waits on this marker to know a pane is still
    // fetching. It must be a real attribute, never a word match on body text.
    return (
      <Box paddingX={1} paddingY={1} data-gloom-status="loading">
        <EmptyState title={loadingText(subject)} />
      </Box>
    );
  }
  if (empty) {
    return (
      <Box paddingX={1} paddingY={1}>
        <EmptyState
          title={emptyTitle ?? t("Nothing to show yet.")}
          message={emptyMessage}
        />
      </Box>
    );
  }
  return <>{children}</>;
}
