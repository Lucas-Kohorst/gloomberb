import { Box } from "../../../../ui";
import { isArticleReaderPane } from "../../../../plugins/builtin/shared/article-pop-out";
import { isFullscreenBasePane } from "../fullscreen";
import type {
  DockDividerLayout,
  DockLeafLayout,
  FloatingRect,
  FloatingResizeCorner,
  LayoutBounds,
  ResolvedPane,
} from "../../../../plugins/pane-manager";
import { colors } from "../../../../theme/colors";
import { constrainFloatingRectToBounds } from "../drag";
import { pathKey } from "../../window-edit/mode";
import { FloatingPaneWrapper } from "../../floating-pane";
import { PaneContent } from "../../pane/content";
import { PaneWrapper } from "../../pane";
import type { PaneHeaderQuickSetting } from "../../pane/header";
import { hasPaneFooterContent, PaneFooterProvider } from "../../pane/footer";
import { PaneHeaderAccessoryProvider } from "../../pane/header-accessory";
import { resolveNativePaneHeaderRows, resolvePaneBodyFrame, shouldReservePaneFooter } from "../../pane/sizing";
import type { DividerPreviewState } from "../native/window-state";

type ShellMouseHandler = (event: any) => void;

interface VisibleFloatingPane {
  pane: ResolvedPane;
  rect: FloatingRect;
}

interface ShellPaneLayersProps {
  contentHeight: number;
  dividerPreview: DividerPreviewState | null;
  dockDividerLayouts: DockDividerLayout[];
  dockLeafLayouts: DockLeafLayout[];
  dragFloatingRect: { paneId: string; rect: FloatingRect } | null;
  focusedPaneId: string | null;
  getPaneTitle: (pane: ResolvedPane) => string;
  getPaneQuickSettings: (paneId: string) => PaneHeaderQuickSetting[];
  handleFloatingClose: (paneId: string) => void;
  handleFloatingCloseMouseDown: (paneId: string, event: any) => void;
  handleRestoreFullscreen: (event: any) => void;
  handleNativeDrag: ShellMouseHandler;
  handleNativePaneContextMenu: (paneId: string, rect: LayoutBounds, event: any) => void;
  handleNativePaneMouseDown: (paneId: string, event: any) => void;
  handlePaneAction: (paneId: string, rect: LayoutBounds, event: any) => void;
  handlePaneFloatToggle: (paneId: string, event: any) => void;
  onTitleMouseDown?: (paneId: string, event: any) => void;
  hoveredPaneId: string | null;
  menuPaneId: string | null;
  nativeContextMenu?: boolean;
  nativePaneChrome: boolean;
  overlayOpen: boolean;
  hiddenDockedIds?: readonly string[];
  paneMap: Map<string, ResolvedPane>;
  setHoveredPaneIfChanged: (paneId: string | null) => void;
  startNativeDividerDrag: (divider: DockDividerLayout, event: any) => void;
  startNativeDockedDrag: (paneId: string, rect: LayoutBounds, event: any) => void;
  startNativeFloatingDrag: (paneId: string, rect: FloatingRect, event: any) => void;
  startNativeFloatResize: (paneId: string, rect: FloatingRect, corner: FloatingResizeCorner, event: any) => void;
  transientFocusActive: boolean;
  transientFocusPaneId: string | null;
  visibleFloatingPanes: VisibleFloatingPane[];
  width: number;
  windowModeDockResizePathKey: string | null;
  windowModePaneId: string | null;
}

export function ShellPaneLayers({
  contentHeight,
  dividerPreview,
  dockDividerLayouts,
  dockLeafLayouts,
  dragFloatingRect,
  focusedPaneId,
  getPaneTitle,
  getPaneQuickSettings,
  handleFloatingClose,
  handleFloatingCloseMouseDown,
  handleRestoreFullscreen,
  handleNativeDrag,
  handleNativePaneContextMenu,
  handleNativePaneMouseDown,
  handlePaneAction,
  handlePaneFloatToggle,
  onTitleMouseDown,
  hoveredPaneId,
  menuPaneId,
  nativeContextMenu,
  nativePaneChrome,
  overlayOpen,
  hiddenDockedIds = [],
  paneMap,
  setHoveredPaneIfChanged,
  startNativeDividerDrag,
  startNativeDockedDrag,
  startNativeFloatingDrag,
  startNativeFloatResize,
  transientFocusActive,
  transientFocusPaneId,
  visibleFloatingPanes,
  width,
  windowModeDockResizePathKey,
  windowModePaneId,
}: ShellPaneLayersProps) {
  const headerRows = nativePaneChrome ? resolveNativePaneHeaderRows() : 1;
  return (
    <>
      {dockLeafLayouts.map((leaf) => {
        const isFullscreenBase = isFullscreenBasePane(transientFocusActive, transientFocusPaneId, leaf.instanceId);
        if (transientFocusActive && !isFullscreenBase && hiddenDockedIds.includes(leaf.instanceId)) return null;
        const pane = paneMap.get(leaf.instanceId);
        if (!pane) return null;
        const rect = isFullscreenBase
          ? { x: 0, y: 0, width, height: contentHeight }
          : leaf.rect;
        const focused = focusedPaneId === leaf.instanceId && (!overlayOpen || menuPaneId === leaf.instanceId);
        const windowModeSelected = windowModePaneId === leaf.instanceId;
        const showActions = focused || hoveredPaneId === leaf.instanceId || menuPaneId === leaf.instanceId;
        return (
          <Box
            key={`dock:${leaf.instanceId}`}
            position="absolute"
            left={rect.x}
            top={rect.y}
            width={rect.width}
            height={rect.height}
            zIndex={isFullscreenBase ? 0 : transientFocusActive ? 10 : undefined}
          >
            <PaneFooterProvider>
              {(footer) => (
                <PaneHeaderAccessoryProvider>
                  {(titleAccessory) => {
                    const showFooter = hasPaneFooterContent(footer);
                    const reserveFooter = shouldReservePaneFooter(nativePaneChrome, showFooter);
                    const renderFooter = reserveFooter || showFooter;
                    const bodyFrame = resolvePaneBodyFrame({
                      width: rect.width,
                      height: rect.height,
                      nativePaneChrome,
                      footerVisible: renderFooter,
                      reserveFooter,
                      headerRows,
                    });
                    return (
                      <PaneWrapper
                        paneId={leaf.instanceId}
                        title={getPaneTitle(pane)}
                        focused={focused}
                        width={rect.width}
                        height={rect.height}
                        showActions={showActions}
                        quickSettings={getPaneQuickSettings(leaf.instanceId)}
                        windowModeSelected={windowModeSelected}
                        footer={footer}
                        titleAccessory={titleAccessory?.node}
                        titleAccessoryWidth={titleAccessory?.width}
                        onMouseDownCapture={nativePaneChrome ? (event) => handleNativePaneMouseDown(leaf.instanceId, event) : undefined}
                        onHeaderMouseMove={() => setHoveredPaneIfChanged(leaf.instanceId)}
                        onHeaderMouseDown={nativePaneChrome && !transientFocusActive ? (event) => startNativeDockedDrag(leaf.instanceId, rect, event) : undefined}
                        onHeaderMouseDrag={nativePaneChrome && !transientFocusActive ? handleNativeDrag : undefined}
                        onHeaderMouseDragEnd={nativePaneChrome && !transientFocusActive ? handleNativeDrag : undefined}
                        onHeaderContextMenu={nativePaneChrome && nativeContextMenu === true ? (event) => handleNativePaneContextMenu(leaf.instanceId, rect, event) : undefined}
                        onActionMouseDown={(event) => handlePaneAction(leaf.instanceId, rect, event)}
                        onFloatToggleMouseDown={nativePaneChrome && !isFullscreenBase ? (event) => handlePaneFloatToggle(leaf.instanceId, event) : undefined}
                        onRestoreMouseDown={isFullscreenBase ? handleRestoreFullscreen : undefined}
                        fullscreen={isFullscreenBase}
                        onTitleMouseDown={onTitleMouseDown && !isArticleReaderPane(pane.instance.paneId)
                          ? (event) => onTitleMouseDown(leaf.instanceId, event)
                          : undefined}
                      >
                        <PaneContent
                          component={pane.def.component}
                          paneId={pane.instance.instanceId}
                          paneType={pane.instance.paneId}
                          focused={focused}
                          width={bodyFrame.width ?? 1}
                          height={bodyFrame.height ?? 1}
                        />
                      </PaneWrapper>
                    );
                  }}
                </PaneHeaderAccessoryProvider>
              )}
            </PaneFooterProvider>
          </Box>
        );
      })}

      {visibleFloatingPanes.map(({ pane, rect }) => {
        const paneId = pane.instance.instanceId;
        const isFullscreenBase = isFullscreenBasePane(transientFocusActive, transientFocusPaneId, paneId);
        const preview = isFullscreenBase
          ? { x: 0, y: 0, width, height: contentHeight }
          : dragFloatingRect?.paneId === paneId
          ? constrainFloatingRectToBounds(dragFloatingRect.rect, width, contentHeight)
          : rect;
        const focused = focusedPaneId === paneId && (!overlayOpen || menuPaneId === paneId);
        const windowModeSelected = windowModePaneId === paneId;
        const showActions = focused || hoveredPaneId === paneId || menuPaneId === paneId;
        return (
          <PaneFooterProvider key={`float:${pane.instance.instanceId}`}>
            {(footer) => (
              <PaneHeaderAccessoryProvider>
                {(titleAccessory) => {
                  const showFooter = hasPaneFooterContent(footer);
                  const reserveFooter = shouldReservePaneFooter(nativePaneChrome, showFooter);
                  const renderFooter = reserveFooter || showFooter;
                  const bodyFrame = resolvePaneBodyFrame({
                    width: preview.width,
                    height: preview.height,
                    nativePaneChrome,
                    footerVisible: renderFooter,
                    reserveFooter,
                    headerRows,
                  });
                  return (
                    <FloatingPaneWrapper
                      paneId={pane.instance.instanceId}
                      title={getPaneTitle(pane)}
                      x={preview.x}
                      y={preview.y}
                      width={preview.width}
                      height={preview.height}
                      zIndex={isFullscreenBase ? 0 : pane.floating?.zIndex ?? 50}
                      focused={focused}
                      windowModeSelected={windowModeSelected}
                      showActions={showActions}
                      quickSettings={getPaneQuickSettings(pane.instance.instanceId)}
                      footer={footer}
                      titleAccessory={titleAccessory?.node}
                      titleAccessoryWidth={titleAccessory?.width}
                      onMouseDownCapture={nativePaneChrome ? (event) => handleNativePaneMouseDown(pane.instance.instanceId, event) : undefined}
                      onHeaderMouseMove={() => setHoveredPaneIfChanged(pane.instance.instanceId)}
                      onHeaderMouseDown={nativePaneChrome && !isFullscreenBase ? (event) => startNativeFloatingDrag(pane.instance.instanceId, preview, event) : undefined}
                      onHeaderMouseDrag={nativePaneChrome && !isFullscreenBase ? handleNativeDrag : undefined}
                      onHeaderMouseDragEnd={nativePaneChrome && !isFullscreenBase ? handleNativeDrag : undefined}
                      onHeaderContextMenu={nativePaneChrome && nativeContextMenu === true ? (event) => handleNativePaneContextMenu(pane.instance.instanceId, preview, event) : undefined}
                      onActionMouseDown={(event) => handlePaneAction(pane.instance.instanceId, preview, event)}
                      onFloatToggleMouseDown={nativePaneChrome && !isFullscreenBase ? (event) => handlePaneFloatToggle(pane.instance.instanceId, event) : undefined}
                      onCloseMouseDown={isFullscreenBase ? undefined : (event) => handleFloatingCloseMouseDown(pane.instance.instanceId, event)}
                      onRestoreMouseDown={isFullscreenBase ? handleRestoreFullscreen : undefined}
                      fullscreen={isFullscreenBase}
                      onTitleMouseDown={onTitleMouseDown && !isArticleReaderPane(pane.instance.paneId)
                        ? (event) => onTitleMouseDown(pane.instance.instanceId, event)
                        : undefined}
                      onResizeMouseDown={nativePaneChrome && !isFullscreenBase
                        ? (corner, event) => startNativeFloatResize(pane.instance.instanceId, preview, corner, event)
                        : undefined}
                      onResizeMouseDrag={nativePaneChrome && !isFullscreenBase ? handleNativeDrag : undefined}
                      onResizeMouseDragEnd={nativePaneChrome && !isFullscreenBase ? handleNativeDrag : undefined}
                    >
                      <PaneContent
                        component={pane.def.component}
                        paneId={pane.instance.instanceId}
                        paneType={pane.instance.paneId}
                        focused={focused}
                        width={bodyFrame.width ?? 1}
                        height={bodyFrame.height ?? 1}
                        onClose={handleFloatingClose}
                      />
                    </FloatingPaneWrapper>
                  );
                }}
              </PaneHeaderAccessoryProvider>
            )}
          </PaneFooterProvider>
        );
      })}

      {dockDividerLayouts.map((divider) => {
        if (transientFocusActive) return null;
        const dividerPathKey = pathKey(divider.path);
        const previewActive = dividerPreview?.pathKey === dividerPathKey;
        const active = previewActive || windowModeDockResizePathKey === dividerPathKey;
        const rect = previewActive ? dividerPreview.rect : divider.rect;
        return (
          <Box
            key={`divider:${divider.path.join(".")}`}
            position="absolute"
            left={rect.x}
            top={rect.y}
            width={rect.width}
            height={rect.height}
            zIndex={active ? 2 : 1}
            backgroundColor={active ? colors.borderFocused : colors.border}
            {...(nativePaneChrome ? {
              "data-gloom-role": "dock-divider",
              "data-axis": divider.axis,
              "data-active": active ? "true" : "false",
              "data-gloom-interactive": "true",
              title: divider.axis === "horizontal" ? "Drag to resize columns" : "Drag to resize rows",
              style: { "--divider-color": active ? colors.borderFocused : colors.border } as any,
            } : {})}
            onMouseDown={nativePaneChrome ? (event: any) => startNativeDividerDrag(divider, event) : undefined}
            onMouseDrag={nativePaneChrome ? handleNativeDrag : undefined}
            onMouseDragEnd={nativePaneChrome ? handleNativeDrag : undefined}
          />
        );
      })}
    </>
  );
}
