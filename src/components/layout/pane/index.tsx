import { Box, useUiCapabilities } from "../../../ui";
import type { ReactNode } from "react";
import { paneBg } from "../../../theme/colors";
import { PaneBodyFrame, getPaneWindowAttributes } from "./frame";
import { PaneHeader, type PaneHeaderQuickSetting } from "./header";
import { hasPaneFooterContent, measurePaneFooterHintRows, PaneFooterBar, type CombinedPaneFooter } from "./footer";
import { resolveNativePaneHeaderRows, resolvePaneBodyFrame, shouldReservePaneFooter } from "./sizing";

interface PaneWrapperProps {
  paneId?: string;
  title?: string;
  focused: boolean;
  windowModeSelected?: boolean;
  width?: number;
  height?: number | `${number}%` | "auto";
  flexGrow?: number;
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
  footer?: CombinedPaneFooter | null;
  titleAccessory?: ReactNode;
  titleAccessoryWidth?: number;
  children: ReactNode;
  onTitleMouseDown?: (event: any) => void;
}

export function PaneWrapper({
  paneId,
  title,
  focused,
  windowModeSelected = false,
  width = 0,
  height,
  flexGrow,
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
  footer,
  titleAccessory,
  titleAccessoryWidth,
  children,
  onTitleMouseDown,
}: PaneWrapperProps) {
  const { cellHeightPx = 18, nativePaneChrome } = useUiCapabilities();
  const bg = paneBg(focused);
  const showFooter = hasPaneFooterContent(footer);
  const reserveFooter = !!title && shouldReservePaneFooter(nativePaneChrome, showFooter);
  const renderFooter = !!title && (reserveFooter || showFooter);
  const footerRows = measurePaneFooterHintRows(footer, Math.max(1, Math.floor(width) - 2), {
    focused,
    nativePaneChrome,
  });
  const bodyFrame = resolvePaneBodyFrame({
    height: typeof height === "number" ? height : undefined,
    nativePaneChrome,
    footerVisible: renderFooter,
    reserveFooter,
    headerRows: title
      ? nativePaneChrome ? resolveNativePaneHeaderRows(cellHeightPx) : 1
      : 0,
    footerRows,
  });

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      flexGrow={flexGrow}
      backgroundColor={bg}
      overflow={nativePaneChrome ? undefined : "hidden"}
      {...getPaneWindowAttributes({
        enabled: nativePaneChrome,
        role: "pane-window",
        paneId,
        floating: false,
        focused,
        windowModeSelected,
        showBorderColor: true,
      })}
      onMouseDown={onMouseDown}
      onMouseDownCapture={onMouseDownCapture}
    >
      {title && (
        <PaneHeader
          title={title}
          width={width}
          focused={focused}
          windowModeSelected={windowModeSelected}
          showActions={showActions}
          quickSettings={quickSettings}
          onHeaderMouseMove={onHeaderMouseMove}
          onHeaderMouseDown={onHeaderMouseDown}
          onHeaderMouseDrag={onHeaderMouseDrag}
          onHeaderMouseDragEnd={onHeaderMouseDragEnd}
          onHeaderContextMenu={onHeaderContextMenu}
          onActionMouseDown={onActionMouseDown}
          onFloatToggleMouseDown={onFloatToggleMouseDown}
          onTitleMouseDown={onTitleMouseDown}
          titleAccessory={titleAccessory}
          titleAccessoryWidth={titleAccessoryWidth}
        />
      )}
      <PaneBodyFrame layoutProps={bodyFrame.layoutProps} backgroundColor={bg}>
        {children}
      </PaneBodyFrame>
      {renderFooter && (
        <PaneFooterBar
          footer={footer}
          focused={focused}
          width={typeof width === "number" ? width : undefined}
        />
      )}
    </Box>
  );
}
