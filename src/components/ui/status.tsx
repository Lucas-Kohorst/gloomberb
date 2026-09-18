import { useCallback, useContext, type ReactNode } from "react";
import { Box, Text, TextAttributes, UiHostContext } from "../../ui";
import { colors } from "../../theme/colors";
import { t, tf } from "../../i18n";

export interface EmptyStateProps {
  title: string;
  message?: string;
  hint?: string;
  /** Fill the parent and center the copy. Default true. */
  fill?: boolean;
  /**
   * Clickable retry for mouse users. When omitted and the hint names the
   * pane's own reload key (`r`), the same key is replayed into the active
   * input pipeline so existing panes get a working retry for free.
   */
  onRetry?: () => void;
}

/** "Press r to retry." style hints advertise a reload the pane already binds. */
const RETRY_HINT_PATTERN = /\bretry\b|\bpress r\b/i;

/**
 * Replays the pane reload key through the running renderer's input pipeline.
 * Pane reloads are single-key `r` shortcuts, so a mouse Retry affordance can
 * behave exactly like the key: focus the pane, then fire `r`. The dispatch is
 * deferred so the mousedown that opened the affordance commits its pane focus
 * first; on the web the event is targeted at the focused element so a focused
 * search input keeps swallowing the key exactly as a real keystroke would.
 */
function pressPaneReloadKey(renderer: unknown, uiKind: string): void {
  setTimeout(() => {
    const possibleRenderer = renderer as {
      keyInput?: { emit?: (event: string, payload: Record<string, unknown>) => void };
    } | null;
    if (uiKind === "opentui" && possibleRenderer?.keyInput?.emit) {
      possibleRenderer.keyInput.emit("keypress", {
        name: "r",
        sequence: "r",
        ctrl: false,
        meta: false,
        option: false,
        alt: false,
        shift: false,
        eventType: "press",
        repeated: false,
        preventDefault() {},
        stopPropagation() {},
      });
      return;
    }
    if (typeof window === "undefined" || typeof KeyboardEvent === "undefined") return;
    const target = (document.activeElement ?? document.body) as Element | null;
    target?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "r",
      bubbles: true,
      cancelable: true,
    }));
  }, 0);
}

/** Mouse path to the focused pane's `r` reload shortcut. */
export function usePaneRetry(): () => void {
  const context = useContext(UiHostContext);
  const renderer = context?.renderer ?? null;
  const uiKind = context?.ui.kind ?? "";
  return useCallback(
    () => {
      if (!renderer || !uiKind) return;
      pressPaneReloadKey(renderer, uiKind);
    },
    [renderer, uiKind],
  );
}

const DATA_ERROR_MESSAGES: Record<string, string> = {
  NO_DATA: "No data is available.",
  NOT_FOUND: "No data is available.",
  BAD_MAPPING: "This symbol is not supported.",
  UNSUPPORTED_RANGE: "This data is not available for the selected range.",
  TIMEOUT: "The request timed out.",
  UPSTREAM_ERROR: "The data source is unavailable.",
};

/** Converts provider reason codes into terse, user-facing copy. */
export function dataErrorMessage(error: string | null | undefined): string {
  const message = error?.trim();
  if (!message) return "The data source is unavailable.";
  const code = message.match(/\b(NO_DATA|NOT_FOUND|BAD_MAPPING|UNSUPPORTED_RANGE|TIMEOUT|UPSTREAM_ERROR)\b/)?.[1];
  return code ? DATA_ERROR_MESSAGES[code] ?? "The data source is unavailable." : "The data source is unavailable.";
}

const NO_DATA_PATTERN =
  /no .{0,48}(data|history|chain|scores|filings|transcripts|news|options|holders|ratings|events|tweets|prices|peers)( found)?(\s+for\b|$)/i;

/** True when the failure is an empty result, not a transport/provider crash. */
export function isNoDataError(error: string | null | undefined): boolean {
  const message = error?.trim();
  if (!message) return false;
  if (/\b(NO_DATA|NOT_FOUND)\b/.test(message)) return true;
  if (/^no .+ available\.?$/i.test(message)) return true;
  return NO_DATA_PATTERN.test(message);
}

export function noDataTitle(kind: string): string {
  return `No ${kind} data`;
}

export function noDataMessage(subject: string, detail: string): string {
  return `${subject} has no ${detail}.`;
}

export function unavailableTitle(kind: string): string {
  if (!kind) return "Data unavailable";
  if (kind === kind.toUpperCase()) return `${kind} data unavailable`;
  return `${kind.charAt(0).toUpperCase()}${kind.slice(1)} data unavailable`;
}

/** Footer chip for real failures. Empty/no-data copy stays in the pane body. */
export function footerErrorChip(error: string | null | undefined): { text: string; tone: "warning" } | null {
  if (!error?.trim()) return null;
  if (isNoDataError(error)) return null;
  return { text: "unavailable", tone: "warning" };
}

export function EmptyState({ title, message, hint, fill = true, onRetry }: EmptyStateProps) {
  const hitRetry = usePaneRetry();
  const retryAction = onRetry ?? (hint && RETRY_HINT_PATTERN.test(hint) ? hitRetry : undefined);
  const body = (
    <Box flexDirection="column" alignItems="center" width="100%">
      <Box height={1} flexShrink={0}>
        <Text fg={colors.textDim} wrapMode="none">{t(title)}</Text>
      </Box>
      {message && (
        <Box width="100%" flexShrink={0}>
          <Text fg={colors.textMuted} wrapMode="word">{t(message)}</Text>
        </Box>
      )}
      {hint && (
        <Box height={1} flexShrink={0}>
          <Text fg={colors.textMuted} wrapMode="none">{t(hint)}</Text>
        </Box>
      )}
      {retryAction && (
        <Box marginTop={1}>
          <RetryButton onRetry={retryAction} />
        </Box>
      )}
    </Box>
  );
  if (!fill) return body;
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      justifyContent="center"
      alignItems="center"
    >
      {body}
    </Box>
  );
}

/** Small bordered chip that invokes the pane retry from the mouse. */
function RetryButton({ onRetry }: { onRetry: () => void }) {
  return (
    <Box
      marginTop={0}
      paddingX={1}
      role="button"
      tabIndex={0}
      aria-label={t("Retry")}
      data-gloom-role="status-retry"
      data-gloom-interactive
      onMouseDown={(event: { preventDefault?: () => void; stopPropagation?: () => void }) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        onRetry();
      }}
      onKeyDown={(event: { key: string; preventDefault?: () => void; stopPropagation?: () => void }) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault?.();
          event.stopPropagation?.();
          onRetry();
        }
      }}
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: 5,
        cursor: "pointer",
        backgroundColor: colors.panel,
      }}
    >
      <Text fg={colors.text} attributes={TextAttributes.BOLD}>{` ${t("Retry")} `}</Text>
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
  /** Retry the pane's own fetch from the mouse (defaults to replaying `r`). */
  onRetry?: () => void;
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
  onRetry,
  children,
}: PaneStatusBodyProps) {
  if (error && !isNoDataError(error)) {
    return (
      <Box paddingX={1} paddingY={1} data-gloom-status="error">
        <EmptyState
          title={subject ? unavailableText(subject) : dataErrorMessage(error)}
          message={subject ? dataErrorMessage(error) : undefined}
          onRetry={onRetry}
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
      <Box paddingX={1} paddingY={1} data-gloom-status="empty">
        <EmptyState
          title={emptyTitle ?? t("Nothing to show yet.")}
          message={emptyMessage}
        />
      </Box>
    );
  }
  return <>{children}</>;
}
