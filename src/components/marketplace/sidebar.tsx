import type { ReactNode } from "react";
import { t } from "../../i18n";
import { useThemeColors } from "../../theme/theme-context";
import { Box, Text, TextAttributes } from "../../ui";
import { PaneSidebarRow } from "../layout/pane/sidebar";

export function MarketplaceSection({ title, count }: { title: string; count: number }) {
  const colors = useThemeColors();
  return (
    <Box height={1} flexDirection="row" alignItems="center" paddingX={1} flexShrink={0}>
      <Text fg={colors.textMuted} attributes={TextAttributes.BOLD}>
        {`${t(title).toUpperCase()} ${count}`}
      </Text>
    </Box>
  );
}

export function MarketplaceNote({ children }: { children: ReactNode }) {
  const colors = useThemeColors();
  return (
    <Box flexDirection="row" paddingX={1} paddingY={1} flexShrink={0}>
      <Text fg={colors.textDim} wrapText>{children}</Text>
    </Box>
  );
}

export function MarketplaceActionRow({
  label,
  onPress,
  rowRole,
}: {
  label: string;
  onPress: () => void;
  rowRole: string;
}) {
  return (
    <PaneSidebarRow active={false} ariaLabel={label} onSelect={onPress}>
      {({ foregroundColor, listWidth, onMouseDown }) => (
        <Box
          width={listWidth}
          height={1}
          flexDirection="row"
          role="button"
          tabIndex={0}
          aria-label={label}
          data-gloom-role={rowRole}
          data-gloom-interactive="true"
          onMouseDown={onMouseDown}
          onKeyDown={(event: { key?: string; preventDefault?: () => void; stopPropagation?: () => void }) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault?.();
            event.stopPropagation?.();
            onPress();
          }}
          style={{ cursor: "pointer" }}
        >
          <Text fg={foregroundColor}>{`  ${label}`}</Text>
        </Box>
      )}
    </PaneSidebarRow>
  );
}
