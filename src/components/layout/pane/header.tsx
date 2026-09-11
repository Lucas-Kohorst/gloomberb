import { Box, Span, Text, useNativeRenderer, useUiCapabilities, useUiHost } from "../../../ui";
import { useCallback, useRef, type ReactNode } from "react";
import { blendHex, colors, floatingPaneTitleBg, paneTitleBg, paneTitleText } from "../../../theme/colors";
import { displayWidth, truncateToDisplayWidth } from "../../../utils/format";
import { capturePointerDrag } from "../../../ui/pointer-drag";
import {
  PANE_HEADER_ACTION,
  PANE_HEADER_CLOSE,
  PANE_HEADER_FLOATING,
  PANE_HEADER_GRIP,
  PANE_HEADER_RESTORE,
  PANE_HEADER_TILED,
  resolveTerminalPaneHeaderGeometry,
} from "./terminal-header-geometry";
import { resolveNativePaneHeaderRows } from "./sizing";

export {
  PANE_HEADER_ACTION,
  PANE_HEADER_CLOSE,
  PANE_HEADER_FLOATING,
  PANE_HEADER_GRIP,
  PANE_HEADER_RESTORE,
  PANE_HEADER_TILED,
} from "./terminal-header-geometry";

const PANE_HEADER_HEIGHT = 1;

interface PaneHeaderProps {
  title: string;
  width: number;
  focused: boolean;
  windowModeSelected?: boolean;
  floating?: boolean;
  fullscreen?: boolean;
  titleAccessory?: ReactNode;
  titleAccessoryWidth?: number;
  showActions?: boolean;
  quickSettings?: PaneHeaderQuickSetting[];
  onHeaderMouseMove?: (event: any) => void;
  onHeaderMouseDown?: (event: any) => void;
  onHeaderMouseDrag?: (event: any) => void;
  onHeaderMouseDragEnd?: (event: any) => void;
  onHeaderContextMenu?: (event: any) => void;
  onActionMouseDown?: (event: any) => void;
  onFloatToggleMouseDown?: (event: any) => void;
  onCloseMouseDown?: (event: any) => void;
  onRestoreMouseDown?: (event: any) => void;
  onTitleMouseDown?: (event: any) => void;
}

export interface PaneHeaderQuickSetting {
  key: string;
  icon: "zap";
  label: string;
  description?: string;
  active: boolean;
  onMouseDown?: (event: any) => void;
}

function truncateTitle(title: string, maxWidth: number): string {
  return truncateToDisplayWidth(title, maxWidth);
}

export function DesktopPaneButton({
  label,
  icon,
  onActivate,
  role,
  color = colors.textDim,
  pressed,
}: {
  label: string;
  icon: ReactNode;
  onActivate?: (event: any) => void;
  role: string;
  color?: string;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onMouseDown={(event) => {
        event.stopPropagation?.();
        if (event.button != null && event.button !== 0) return;
        onActivate?.(event);
      }}
      onClick={(event) => {
        event.stopPropagation?.();
        if (typeof event.detail === "number" && event.detail > 0) return;
        onActivate?.(event);
      }}
      data-gloom-role={role}
      data-gloom-interactive={onActivate ? "true" : undefined}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      style={{
        appearance: "none",
        border: 0,
        borderRadius: 4,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        alignSelf: "stretch",
        height: "100%",
        minWidth: 28,
        margin: 0,
        padding: 0,
        paddingInline: 6,
        lineHeight: 0,
        backgroundColor: "transparent",
        cursor: onActivate ? "pointer" : "default",
      }}
    >
      <Span
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 12,
          height: 12,
          lineHeight: 0,
          overflow: "hidden",
          color,
        }}
      >
        {icon}
      </Span>
    </button>
  );
}

function TerminalPaneButton({
  text,
  fg,
  role,
  onMouseDown,
}: {
  text: string;
  fg: string;
  role: string;
  onMouseDown?: (event: any) => void;
}) {
  return (
    <Box
      height={1}
      width={displayWidth(text)}
      flexShrink={0}
      flexDirection="row"
      data-gloom-role={role}
      data-gloom-interactive={onMouseDown ? "true" : undefined}
      onMouseDown={onMouseDown}
    >
      <Text fg={fg} selectable={false}>{text}</Text>
    </Box>
  );
}

export function PaneHeader({
  title,
  width,
  focused,
  windowModeSelected = false,
  floating = false,
  fullscreen = false,
  titleAccessory,
  titleAccessoryWidth = 0,
  showActions = false,
  quickSettings = [],
  onHeaderMouseMove,
  onHeaderMouseDown,
  onHeaderMouseDrag,
  onHeaderMouseDragEnd,
  onHeaderContextMenu,
  onActionMouseDown,
  onFloatToggleMouseDown,
  onCloseMouseDown,
  onRestoreMouseDown,
  onTitleMouseDown,
}: PaneHeaderProps) {
  const { cellHeightPx = 18, nativePaneChrome } = useUiCapabilities();
  const uiKind = useUiHost().kind;
  const nativeRenderer = useNativeRenderer();
  const terminalHeaderRef = useRef<unknown>(null);
  const visuallyFocused = focused || windowModeSelected;
  const headerHeight = nativePaneChrome ? resolveNativePaneHeaderRows(cellHeightPx) : PANE_HEADER_HEIGHT;
  const backgroundColor = floating ? floatingPaneTitleBg(visuallyFocused) : paneTitleBg(visuallyFocused);
  const floatToggleText = floating ? PANE_HEADER_FLOATING : PANE_HEADER_TILED;
  const floatToggleLabel = floating
    ? "Pane is floating — tile pane"
    : "Pane is tiled — float pane";
  const textColor = paneTitleText(visuallyFocused, floating);
  const terminalGeometry = resolveTerminalPaneHeaderGeometry(width, {
    floating,
    focused: visuallyFocused,
    showActions,
    fullscreen,
  });
  const handleTerminalHeaderMouseDown = useCallback((event: any) => {
    capturePointerDrag(nativeRenderer, terminalHeaderRef.current);
    onHeaderMouseDown?.(event);
  }, [nativeRenderer, onHeaderMouseDown]);

  if (nativePaneChrome) {
    return (
      <Box
        height={headerHeight}
        width={width}
        backgroundColor={backgroundColor}
        flexDirection="row"
        alignItems="center"
        overflow="hidden"
        data-gloom-role="pane-header"
        data-floating={floating ? "true" : "false"}
        data-focused={focused ? "true" : "false"}
        data-window-mode-selected={windowModeSelected ? "true" : "false"}
        data-title-drag={onTitleMouseDown ? undefined : "true"}
        aria-label="Drag to move pane"
        title="Drag to move pane"
        onMouseDown={onHeaderMouseDown}
        onMouseMove={onHeaderMouseMove}
        onMouseDrag={onHeaderMouseDrag}
        onMouseDragEnd={onHeaderMouseDragEnd}
        onContextMenu={onHeaderContextMenu}
        style={{
          borderBottom: `1px solid ${visuallyFocused ? colors.borderFocused : colors.border}`,
          paddingInline: 8,
          boxShadow: visuallyFocused
            ? `inset 0 -1px 0 ${blendHex(paneTitleBg(visuallyFocused), colors.borderFocused, 0.18)}`
            : `inset 0 -1px 0 ${blendHex(paneTitleBg(visuallyFocused), colors.textBright, 0.04)}`,
        }}
      >
        <Box
          data-gloom-role="pane-grip"
          flexShrink={0}
          alignItems="center"
          justifyContent="center"
          title="Drag to move pane"
          style={{
            width: 18,
            height: 18,
            color: visuallyFocused ? colors.borderFocused : colors.textMuted,
            cursor: "grab",
          }}
        >
          {uiKind === "opentui" ? (
            // The terminal renderer has no SVG host elements; fall back to the cell grip.
            <Text fg={visuallyFocused ? colors.borderFocused : colors.textMuted} selectable={false}>
              {PANE_HEADER_GRIP}
            </Text>
          ) : (
            <Span style={{ display: "inline-flex", width: 10, height: 16, color: "inherit" }}>
              <svg viewBox="0 0 10 16" width="10" height="16" fill="currentColor" aria-hidden="true">
                <circle cx="3" cy="2.5" r="1.15" />
                <circle cx="7" cy="2.5" r="1.15" />
                <circle cx="3" cy="8" r="1.15" />
                <circle cx="7" cy="8" r="1.15" />
                <circle cx="3" cy="13.5" r="1.15" />
                <circle cx="7" cy="13.5" r="1.15" />
              </svg>
            </Span>
          )}
        </Box>
        <Box flexGrow={1} minWidth={0} overflow="hidden" flexDirection="row" alignItems="center">
          <Text
            fg={textColor}
            selectable={false}
            data-gloom-role="pane-title"
            data-gloom-interactive={onTitleMouseDown ? "true" : undefined}
            onMouseDown={onTitleMouseDown ? (event: any) => {
              event.stopPropagation?.();
              event.preventDefault?.();
              onTitleMouseDown(event);
            } : undefined}
            style={{
              fontWeight: visuallyFocused ? 700 : 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              flexShrink: 1,
              minWidth: 0,
              cursor: onTitleMouseDown ? "text" : undefined,
              userSelect: onTitleMouseDown ? undefined : "none",
            }}
          >
            {title}
          </Text>
          {titleAccessory}
        </Box>
        {quickSettings.map((setting) => (
          <Box key={setting.key} data-gloom-role="pane-quick-setting" data-setting-key={setting.key}>
            <DesktopPaneButton
              label={`${setting.label}: ${setting.active ? "on" : "off"}`}
              onActivate={setting.onMouseDown}
              role="pane-quick-setting"
              color={setting.active ? colors.warning : colors.textDim}
              pressed={setting.active}
              icon={(
                <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true">
                  <path d="M7.1 1.2 2.7 6.5h3.1l-.7 4.3 4.4-5.5H6.4l.7-4.1Z" fill="currentColor" />
                </svg>
              )}
            />
          </Box>
        ))}
        <Box
          data-gloom-role="pane-header-actions"
          flexDirection="row"
          alignItems="center"
          justifyContent="center"
          height="100%"
          flexShrink={0}
          position="relative"
          zIndex={2}
        >
          {fullscreen ? null : uiKind === "opentui" ? (
            <TerminalPaneButton
              text={floatToggleText}
              fg={colors.textDim}
              role="pane-float-toggle"
              onMouseDown={onFloatToggleMouseDown}
            />
          ) : (
            <DesktopPaneButton
              label={floatToggleLabel}
              onActivate={onFloatToggleMouseDown}
              role="pane-float-toggle"
              icon={floating ? (
                <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true">
                  <rect x="1.5" y="1.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" />
                  <rect x="4.5" y="4.5" width="6" height="6" rx="1" fill={backgroundColor} stroke="currentColor" strokeWidth="1.2" />
                </svg>
              ) : (
                <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true">
                  <rect x="1" y="1" width="10" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M6 1V11M1 6H11" stroke="currentColor" strokeWidth="1" />
                </svg>
              )}
            />
          )}
          {showActions ? (
            uiKind === "opentui" ? (
              <TerminalPaneButton text={PANE_HEADER_ACTION} fg={colors.textDim} role="pane-action" onMouseDown={onActionMouseDown} />
            ) : (
              <DesktopPaneButton
                label="Pane actions"
                onActivate={onActionMouseDown}
                role="pane-action"
                icon={(
                  <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true">
                    <circle cx="2" cy="6" r="1.1" fill="currentColor" />
                    <circle cx="6" cy="6" r="1.1" fill="currentColor" />
                    <circle cx="10" cy="6" r="1.1" fill="currentColor" />
                  </svg>
                )}
              />
            )
          ) : <Box width={2} />}
        </Box>
        {(fullscreen || floating) && (
          <Box
            data-gloom-role={fullscreen ? "pane-restore" : "pane-close"}
            marginLeft={1}
            height="100%"
            alignItems="center"
            justifyContent="center"
            position="relative"
            zIndex={2}
          >
            {uiKind === "opentui" ? (
              <TerminalPaneButton
                text={fullscreen ? PANE_HEADER_RESTORE : PANE_HEADER_CLOSE}
                fg={colors.textDim}
                role={fullscreen ? "pane-restore" : "pane-close"}
                onMouseDown={fullscreen ? onRestoreMouseDown : onCloseMouseDown}
              />
            ) : (
              <DesktopPaneButton
                label={fullscreen ? "Restore pane" : "Close pane"}
                onActivate={fullscreen ? onRestoreMouseDown : onCloseMouseDown}
                role={fullscreen ? "pane-restore" : "pane-close"}
                icon={fullscreen ? (
                  <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true">
                    <path d="M2.5 6H9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true">
                    <path
                      d="M3 3L9 9M9 3L3 9"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                )}
              />
            )}
          </Box>
        )}
      </Box>
    );
  }

  const accessoryWidth = Math.max(0, Math.floor(titleAccessoryWidth));

  if (visuallyFocused || floating || fullscreen) {
    const borderColor = visuallyFocused ? colors.borderFocused : colors.border;
    const grip = truncateTitle(PANE_HEADER_GRIP, terminalGeometry.contentWidth);
    const titleWidth = Math.max(0, terminalGeometry.contentWidth - displayWidth(grip) - accessoryWidth);
    const clippedTitle = truncateTitle(title, titleWidth);
    const fillLen = Math.max(0, terminalGeometry.contentWidth - displayWidth(grip) - displayWidth(clippedTitle) - accessoryWidth);
    const fill = "─".repeat(fillLen);

    return (
      <Box
        ref={terminalHeaderRef}
        height={PANE_HEADER_HEIGHT}
        width={width}
        backgroundColor={backgroundColor}
        flexDirection="row"
        onMouseDown={handleTerminalHeaderMouseDown}
        onMouseMove={onHeaderMouseMove}
        onMouseDrag={onHeaderMouseDrag}
        onMouseDragEnd={onHeaderMouseDragEnd}
      >
        <Text
          width={displayWidth(terminalGeometry.leftBorder)}
          flexShrink={0}
          fg={borderColor}
          selectable={false}
        >
          {terminalGeometry.leftBorder}
        </Text>
        <Box width={terminalGeometry.contentWidth} flexShrink={0} flexDirection="row">
          <Text fg={textColor} selectable={false}>{`${grip}${clippedTitle}`}</Text>
          {titleAccessory}
          <Text fg={textColor} selectable={false}>{fill}</Text>
        </Box>
        {terminalGeometry.controls.toggle && (
          <TerminalPaneButton
            text={terminalGeometry.controls.toggle.text}
            fg={visuallyFocused ? colors.borderFocused : textColor}
            role="pane-float-toggle"
            onMouseDown={onFloatToggleMouseDown}
          />
        )}
        {terminalGeometry.controls.action && (
          <TerminalPaneButton
            text={terminalGeometry.controls.action.text}
            fg={textColor}
            role="pane-action"
            onMouseDown={onActionMouseDown}
          />
        )}
        {terminalGeometry.controls.close && (
          <TerminalPaneButton
            text={terminalGeometry.controls.close.text}
            fg={textColor}
            role={fullscreen ? "pane-restore" : "pane-close"}
            onMouseDown={fullscreen ? onRestoreMouseDown : onCloseMouseDown}
          />
        )}
        <Text
          width={displayWidth(terminalGeometry.rightBorder)}
          flexShrink={0}
          fg={borderColor}
          selectable={false}
        >
          {terminalGeometry.rightBorder}
        </Text>
      </Box>
    );
  }

  const grip = truncateTitle(PANE_HEADER_GRIP, terminalGeometry.contentWidth);
  const titleWidth = Math.max(0, terminalGeometry.contentWidth - displayWidth(grip) - accessoryWidth);
  const clippedTitle = truncateTitle(title, titleWidth);
  const padding = " ".repeat(Math.max(0, titleWidth - displayWidth(clippedTitle)));

  return (
    <Box
      ref={terminalHeaderRef}
      height={PANE_HEADER_HEIGHT}
      width={width}
      backgroundColor={backgroundColor}
      flexDirection="row"
      onMouseDown={handleTerminalHeaderMouseDown}
      onMouseMove={onHeaderMouseMove}
      onMouseDrag={onHeaderMouseDrag}
      onMouseDragEnd={onHeaderMouseDragEnd}
    >
      <Box width={terminalGeometry.contentWidth} flexShrink={0} flexDirection="row">
        <Text fg={textColor} selectable={false}>{`${grip}${clippedTitle}`}</Text>
        {titleAccessory}
        <Text fg={textColor} selectable={false}>{padding}</Text>
      </Box>
      {terminalGeometry.controls.toggle && (
        <TerminalPaneButton
          text={terminalGeometry.controls.toggle.text}
          fg={textColor}
          role="pane-float-toggle"
          onMouseDown={onFloatToggleMouseDown}
        />
      )}
      {terminalGeometry.controls.action && (
        <TerminalPaneButton
          text={terminalGeometry.controls.action.text}
          fg={textColor}
          role="pane-action"
          onMouseDown={onActionMouseDown}
        />
      )}
    </Box>
  );
}
