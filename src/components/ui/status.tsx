import { Box, Text } from "../../ui";
import { colors } from "../../theme/colors";
import { t } from "../../i18n";

export interface EmptyStateProps {
  title: string;
  message?: string;
  hint?: string;
  /** Fill the parent and center the copy. Default true. */
  fill?: boolean;
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

export function EmptyState({ title, message, hint, fill = true }: EmptyStateProps) {
  const body = (
    <Box flexDirection="column" alignItems="center">
      <Box>
        <Text fg={colors.textDim}>{t(title)}</Text>
      </Box>
      {message && (
        <Box>
          <Text fg={colors.textDim}>{t(message)}</Text>
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
