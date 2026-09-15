import { Box, Text, useUiHost, type ContextMenuEventLike } from "../../ui";
import { TextAttributes } from "../../ui";
import { type ComponentType, type ReactNode } from "react";
import { t } from "../../i18n";
import { blendHex, type ThemeColors } from "../../theme/colors";
import { useThemeColors } from "../../theme/theme-context";
import { useDialogDismiss } from "../../ui/dialog";

export interface ModalSurfaceOptions {
  width?: string;
  maxHeight?: string;
  /** Set to 0 when the content brings its own padding, e.g. `DialogFrame`. */
  padding?: number;
}

/**
 * Border, background and shadow for a floating panel on the DOM renderer,
 * matching the `.gloom-dialog` surface so the onboarding modal and the hosted
 * terminal's sign-in gate sit at the same elevation as a real dialog.
 */
export function modalSurfaceStyle(colors: ThemeColors, options: ModalSurfaceOptions = {}) {
  return {
    width: options.width ?? "min(540px, 100%)",
    height: "auto",
    maxHeight: options.maxHeight ?? "calc(100vh - 88px)",
    padding: options.padding ?? 14,
    backgroundColor: blendHex(colors.panel, colors.bg, 0.12),
    border: `1px solid ${blendHex(colors.border, colors.borderFocused, 0.18)}`,
    borderRadius: 6,
    boxShadow: `0 18px 48px color-mix(in srgb, ${colors.bg} 46%, transparent), inset 0 1px 0 color-mix(in srgb, ${colors.textBright} 5%, transparent)`,
    boxSizing: "border-box" as const,
    overflowY: "auto" as const,
  };
}

export interface DialogFrameProps {
  title: string;
  children: ReactNode;
  footer?: string;
  showTitleDivider?: boolean;
  dismiss?: () => void;
}

export function DialogFrame({
  title: rawTitle,
  children,
  footer: rawFooter,
  showTitleDivider = false,
  dismiss,
}: DialogFrameProps) {
  const title = t(rawTitle);
  const footer = rawFooter === undefined ? undefined : t(rawFooter);
  const colors = useThemeColors();
  const contextDismiss = useDialogDismiss();
  const closeDialog = dismiss ?? contextDismiss;
  const HostDialogFrame = useUiHost().DialogFrame as ComponentType<DialogFrameProps> | undefined;
  if (HostDialogFrame) {
    return (
      <HostDialogFrame title={title} footer={footer} showTitleDivider={showTitleDivider} dismiss={closeDialog}>
        {children}
      </HostDialogFrame>
    );
  }

  return (
    <Box flexDirection="column">
      <Box height={1} flexDirection="row" alignItems="center">
        <Text fg={colors.text} attributes={TextAttributes.BOLD}>{title}</Text>
        {closeDialog && (
          // Adjacent, not cornered: the frame cannot know the content width, and
          // a stretched close cell would poke past narrow dialogs' content area.
          <Box
            width={3}
            height={1}
            flexShrink={0}
            marginLeft={1}
            justifyContent="center"
            alignItems="center"
            onMouseDown={(event: ContextMenuEventLike) => {
              event.stopPropagation?.();
              event.preventDefault?.();
              closeDialog();
            }}
            data-gloom-interactive="true"
            data-gloom-role="dialog-close"
            title={t("Close")}
            aria-label={t("Close")}
            style={{ cursor: "pointer" }}
          >
            <Text fg={colors.textMuted}>×</Text>
          </Box>
        )}
      </Box>
      <Box height={1} />
      {children}
      {footer && (
        <>
          <Box height={1} />
          <Box height={1}>
            <Text fg={colors.textMuted}>{footer}</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
