import { Box, Text, useUiCapabilities } from "../../ui";
import type { ReactNode } from "react";
import { colors, floatingPaneBg } from "../../theme/colors";
import type { FloatingResizeCorner } from "../../plugins/pane-manager";
import { PaneBodyFrame, getPaneWindowAttributes } from "./pane/frame";
import { PaneHeader, type PaneHeaderQuickSetting } from "./pane/header";
import { hasPaneFooterContent, measurePaneFooterHintRows, PaneFooterBar, type CombinedPaneFooter } from "./pane/footer";
import { resolveNativePaneHeaderRows, resolvePaneBodyFrame, shouldReservePaneFooter } from "./pane/sizing";

interface FloatingPaneWrapperProps {
  paneId?: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  focused: boolean;
  windowModeSelected?: boolean;
  showActions?: boolean;
  quickSettings?: PaneHeaderQuickSetting[];
  onMouseDown?: (event: any) => void;
  onMouseDownCapture?: (event: any) => void;
  onHeaderMouseMove?: (event: any) => void;
  onHeaderMouseDown?: (event: any) => void;
  onHeaderMouseDrag?: (event: any) => void;
  onHeaderMouseDragEnd?: (event: any) => void;
  onHeaderContextMenu?: (event: any) => void;
  onActionMouseDown?: (event: any) => void;
  onFloatToggleMouseDown?: (event: any) => void;
  onCloseMouseDown?: (event: any) => void;
  onTitleMouseDown?: (event: any) => void;
  onResizeMouseDown?: (corner: FloatingResizeCorner, event: any) => void;
  onResizeMouseDrag?: (event: any) => void;
  onResizeMouseDragEnd?: (event: any) => void;
  footer?: CombinedPaneFooter | null;
  titleAccessory?: ReactNode;
  titleAccessoryWidth?: number;
  children: ReactNode;
}

const FLOATING_RESIZE_CORNERS: FloatingResizeCorner[] = [
  "top-left",
  "top",
  "top-right",
  "left",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
];

function nativeResizeHandleLayout(corner: FloatingResizeCorner, width: number, height: number) {
  const sideHeight = Math.max(0, height - 2);
  const topWidth = Math.min(4, Math.max(0, width - 4));
  const topLeft = Math.max(2, Math.floor((width - topWidth) / 2));
  switch (corner) {
    case "top-left":
      return { top: 0, left: 0, width: 2, height: 1 };
    case "top-right":
      return { top: 0, right: 0, width: 2, height: 1 };
    case "top":
      return { top: 0, left: topLeft, width: topWidth, height: 1, zIndex: 1 };
    case "left":
      return { top: 1, left: 0, width: 1, height: sideHeight };
    case "right":
      return { top: 1, right: 0, width: 1, height: sideHeight };
    case "bottom-left":
      return { bottom: 0, left: 0, width: 2, height: 1 };
    case "bottom":
      return { bottom: 0, left: 2, width: Math.max(0, width - 4), height: 1 };
    case "bottom-right":
      return { bottom: 0, right: 0, width: 2, height: 1 };
  }
}

function NativeFloatingResizeHandles({
  width,
  height,
  onResizeMouseDown,
  onResizeMouseDrag,
  onResizeMouseDragEnd,
}: {
  width: number;
  height: number;
  onResizeMouseDown?: (corner: FloatingResizeCorner, event: any) => void;
  onResizeMouseDrag?: (event: any) => void;
  onResizeMouseDragEnd?: (event: any) => void;
}) {
  return (
    <>
      {FLOATING_RESIZE_CORNERS.map((corner) => (
        <Box
          key={corner}
          position="absolute"
          {...nativeResizeHandleLayout(corner, width, height)}
          data-gloom-role="resize-handle"
          data-corner={corner}
          data-gloom-interactive="true"
          aria-label={`Resize pane ${corner.replace("-", " ")}`}
          title={`Resize ${corner.replace("-", " ")}`}
          onMouseDown={(event: any) => onResizeMouseDown?.(corner, event)}
          onMouseDrag={onResizeMouseDrag}
          onMouseDragEnd={onResizeMouseDragEnd}
        />
      ))}
    </>
  );
}

function TerminalFloatingPaneBorder({ width, height }: { width: number; height: number }) {
  const borderWidth = Math.max(0, Math.floor(width));
  const borderHeight = Math.max(0, Math.floor(height));
  const bodyHeight = Math.max(0, borderHeight - 2);
  if (borderWidth < 2 || bodyHeight <= 0) return null;

  return (
    <>
      <Box position="absolute" top={1} left={0} width={1} height={bodyHeight}>
        <Text fg={colors.border} selectable={false}>{"│".repeat(bodyHeight)}</Text>
      </Box>
      <Box position="absolute" top={1} left={borderWidth - 1} width={1} height={bodyHeight}>
        <Text fg={colors.border} selectable={false}>{"│".repeat(bodyHeight)}</Text>
      </Box>
    </>
  );
}

/** Pure visual wrapper; Shell owns the interaction state and supplies handlers. */
export function FloatingPaneWrapper({
  paneId,
  title,
  x,
  y,
  width,
  height,
  zIndex,
  focused,
  windowModeSelected = false,
  showActions = false,
  quickSettings,
  onMouseDown,
  onMouseDownCapture,
  onHeaderMouseMove,
  onHeaderMouseDown,
  onHeaderMouseDrag,
  onHeaderMouseDragEnd,
  onHeaderContextMenu,
  onActionMouseDown,
  onFloatToggleMouseDown,
  onCloseMouseDown,
  onTitleMouseDown,
  onResizeMouseDown,
  onResizeMouseDrag,
  onResizeMouseDragEnd,
  footer,
  titleAccessory,
  titleAccessoryWidth,
  children,
}: FloatingPaneWrapperProps) {
  const { cellHeightPx = 18, nativePaneChrome } = useUiCapabilities();
  const bg = floatingPaneBg(focused);
  const showFooter = hasPaneFooterContent(footer);
  const reserveFooter = shouldReservePaneFooter(nativePaneChrome, showFooter);
  const renderFooter = reserveFooter || showFooter;
  const footerRows = measurePaneFooterHintRows(footer, Math.max(1, width - 2 - 2), {
    focused,
    nativePaneChrome,
  });
  const bodyFrame = resolvePaneBodyFrame({
    height,
    nativePaneChrome,
    footerVisible: renderFooter,
    reserveFooter,
    headerRows: nativePaneChrome ? resolveNativePaneHeaderRows(cellHeightPx) : 1,
    footerRows,
  });

  return (
    <Box
      id={`floating-pane:${paneId}`}
      position="absolute"
      top={y}
      left={x}
      width={width}
      height={height}
      zIndex={zIndex}
      backgroundColor={bg}
      flexDirection="column"
      overflow={nativePaneChrome ? undefined : "hidden"}
      {...getPaneWindowAttributes({
        enabled: nativePaneChrome,
        role: "pane-window",
        paneId,
        floating: true,
        focused,
        windowModeSelected,
        showBorderColor: true,
      })}
      onMouseDown={onMouseDown}
      onMouseDownCapture={onMouseDownCapture}
    >
      <PaneHeader
        title={title}
        width={width}
        focused={focused}
        windowModeSelected={windowModeSelected}
        floating
        showActions={showActions}
        quickSettings={quickSettings}
        onHeaderMouseMove={onHeaderMouseMove}
        onHeaderMouseDown={onHeaderMouseDown}
        onHeaderMouseDrag={onHeaderMouseDrag}
        onHeaderMouseDragEnd={onHeaderMouseDragEnd}
        onHeaderContextMenu={onHeaderContextMenu}
        onActionMouseDown={onActionMouseDown}
        onFloatToggleMouseDown={onFloatToggleMouseDown}
        onCloseMouseDown={onCloseMouseDown}
        onTitleMouseDown={onTitleMouseDown}
        titleAccessory={titleAccessory}
        titleAccessoryWidth={titleAccessoryWidth}
      />

      <PaneBodyFrame layoutProps={bodyFrame.layoutProps} backgroundColor={bg}>
        {children}
      </PaneBodyFrame>

      {renderFooter && (
        <PaneFooterBar
          footer={footer}
          focused={focused}
          width={width}
          reserveRight={2}
          showBorder={!nativePaneChrome && !focused}
        />
      )}

      {!nativePaneChrome && !focused && <TerminalFloatingPaneBorder width={width} height={height} />}

      {nativePaneChrome ? (
        <NativeFloatingResizeHandles
          width={width}
          height={height}
          onResizeMouseDown={onResizeMouseDown}
          onResizeMouseDrag={onResizeMouseDrag}
          onResizeMouseDragEnd={onResizeMouseDragEnd}
        />
      ) : (
        <Box position="absolute" bottom={0} right={0} width={2} height={1}>
          <Text fg={focused ? colors.borderFocused : colors.border} selectable={false}>{"─◢"}</Text>
        </Box>
      )}
    </Box>
  );
}
