import { useCallback } from "react";
import { Box, Text } from "../../ui";
import { blendHex } from "../../theme/colors";
import { useThemeColors } from "../../theme/theme-context";
import { useAppDispatch, useAppSelector } from "../../state/app/context";
import { selectCommandBarOpen } from "../../state/selectors-ui";
import { t } from "../../i18n";
import { buildHeaderCommandBarOpenAction, HEADER_COMMAND_BAR_PLACEHOLDER } from "./header-ticker";

export function HeaderTickerSlot() {
  const colors = useThemeColors();
  const dispatch = useAppDispatch();
  const commandBarOpen = useAppSelector(selectCommandBarOpen);

  const openCommandBar = useCallback((event?: { preventDefault?: () => void; stopPropagation?: () => void }) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (commandBarOpen) return;
    dispatch(buildHeaderCommandBarOpenAction());
  }, [commandBarOpen, dispatch]);

  const placeholderColor = blendHex(colors.headerText, colors.header, 0.55);
  const borderColor = commandBarOpen
    ? blendHex(colors.border, colors.headerText, 0.55)
    : blendHex(colors.border, colors.headerText, 0.28);

  return (
    <Box
      height={1}
      flexDirection="row"
      alignItems="center"
      data-gloom-role="header-ticker-slot"
      data-gloom-interactive="true"
      className="electrobun-webkit-app-region-no-drag"
      role="button"
      tabIndex={0}
      aria-label={t("Open command bar")}
      aria-keyshortcuts="Control+P Control+K Meta+K"
      onMouseDown={openCommandBar}
      onKeyDown={(event: { key?: string; preventDefault?: () => void; stopPropagation?: () => void }) => {
        if (event.key === "Enter" || event.key === " ") openCommandBar(event);
      }}
      style={{
        border: `1px solid ${borderColor}`,
        borderRadius: 5,
        paddingInline: 8,
        minWidth: 240,
        backgroundColor: blendHex(colors.header, colors.headerText, commandBarOpen ? 0.14 : 0.08),
        cursor: "text",
      }}
    >
      <Text fg={placeholderColor} style={{ fontSize: 12, fontWeight: 600 }}>
        {t(HEADER_COMMAND_BAR_PLACEHOLDER)}
      </Text>
    </Box>
  );
}
