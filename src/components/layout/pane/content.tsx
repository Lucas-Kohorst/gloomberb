import { Component, memo, useCallback, type ErrorInfo, type ReactNode } from "react";
import { useAppLanguage } from "../../../i18n/react";
import { PaneInstanceProvider } from "../../../state/app/context";
import { useThemeColors } from "../../../theme/theme-context";
import { PaneKeyboardScrollController } from "../../../state/pane-scroll-registry";
import type { PaneDef } from "../../../types/plugin";
import { Box, Text } from "../../../ui";

interface PaneContentProps {
  component: PaneDef["component"];
  paneId: string;
  paneType: string;
  focused: boolean;
  width: number;
  height: number;
  onClose?: (paneId: string) => void;
}

class PaneRenderErrorBoundary extends Component<
  { paneType: string; children: ReactNode },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[pane] render failed", this.props.paneType, error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return <Text>{`Pane "${this.props.paneType}" crashed: ${this.state.error.message}`}</Text>;
    }
    return this.props.children;
  }
}

export const PaneContent = memo(function PaneContent({
  component: Component,
  paneId,
  paneType,
  focused,
  width,
  height,
  onClose,
}: PaneContentProps) {
  useAppLanguage();
  useThemeColors();
  const close = useCallback(() => {
    onClose?.(paneId);
  }, [onClose, paneId]);

  return (
    <PaneInstanceProvider paneId={paneId}>
      <PaneKeyboardScrollController paneId={paneId} focused={focused} />
      <Box
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        flexBasis={0}
        minWidth={0}
        minHeight={0}
        overflow="hidden"
        data-gloom-role="pane-content"
      >
        <PaneRenderErrorBoundary paneType={paneType}>
          {typeof Component === "function" ? (
            <Component
              paneId={paneId}
              paneType={paneType}
              focused={focused}
              width={width}
              height={height}
              close={onClose ? close : undefined}
            />
          ) : (
            <Text>{`Pane "${paneType}" has no view.`}</Text>
          )}
        </PaneRenderErrorBoundary>
      </Box>
    </PaneInstanceProvider>
  );
});
