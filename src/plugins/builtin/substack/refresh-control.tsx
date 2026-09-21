import { Box } from "../../../ui";
import { Button } from "../../../components";
import { t } from "../../../i18n";
import { colors } from "../../../theme/colors";
import { useUiCapabilities } from "../../../ui";

export const SUBSTACK_REFRESH_ROLE = "substack-refresh";

/**
 * Visible feed reload for mouse users. Desktop/web uses a real `<button>`;
 * the terminal falls back to the shared Button primitive. Do not advertise
 * `[r]` in the pane footer — global `r` already refreshes.
 */
export function SubstackRefreshControl({
  onRefresh,
  loading = false,
}: {
  onRefresh: () => void;
  loading?: boolean;
}) {
  const { nativePaneChrome } = useUiCapabilities();
  const label = loading ? t("Refreshing") : t("Refresh");

  if (nativePaneChrome) {
    return (
      <button
        type="button"
        aria-label={label}
        aria-busy={loading || undefined}
        disabled={loading}
        data-gloom-role={SUBSTACK_REFRESH_ROLE}
        data-gloom-interactive={loading ? undefined : "true"}
        title={label}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!loading) onRefresh();
        }}
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
        style={{
          appearance: "none",
          border: `1px solid ${colors.border}`,
          borderRadius: 4,
          backgroundColor: colors.panel,
          color: loading ? colors.textMuted : colors.text,
          cursor: loading ? "default" : "pointer",
          font: "inherit",
          fontWeight: 600,
          height: "100%",
          minHeight: 22,
          minWidth: 72,
          padding: "0 8px",
          margin: 0,
          lineHeight: 1,
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <Box
      height={1}
      flexShrink={0}
      data-gloom-role={SUBSTACK_REFRESH_ROLE}
      data-gloom-interactive={loading ? undefined : "true"}
    >
      <Button
        label={label}
        variant="secondary"
        disabled={loading}
        onPress={onRefresh}
      />
    </Box>
  );
}
