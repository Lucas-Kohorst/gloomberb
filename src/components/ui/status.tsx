import { Box, Text } from "../../ui";
import { colors } from "../../theme/colors";
import { t } from "../../i18n";

export interface EmptyStateProps {
  title: string;
  message?: string;
  hint?: string;
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

export function EmptyState({ title, message, hint }: EmptyStateProps) {
  return (
    <Box flexDirection="column">
      <Box height={1}>
        <Text fg={colors.textDim}>{t(title)}</Text>
      </Box>
      {message && (
        <Box height={1}>
          <Text fg={colors.textMuted}>{t(message)}</Text>
        </Box>
      )}
      {hint && (
        <Box height={1}>
          <Text fg={colors.textMuted}>{t(hint)}</Text>
        </Box>
      )}
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
export function ErrorState({ error, hint }: { error: string | null | undefined; hint?: string }) {
  return <EmptyState title={dataErrorMessage(error)} hint={hint} />;
}
