import { Box, Text, TextAttributes, useUiCapabilities } from "../../ui";
import { useEffect, useState } from "react";
import { blendHex, colors, hoverBg } from "../../theme/colors";
import { t } from "../../i18n";
import { useThemeColors } from "../../theme/theme-context";
import { useAppDispatch, useAppSelector } from "../../state/app/context";
import { VERSION } from "../../version";
import {
  selectGridlockTipSequence,
  selectGridlockTipVisible,
  selectStatusBarVisible,
} from "../../state/selectors-ui";
import { getSharedRegistry } from "../../plugins/registry";
import { gridlockAllPanes } from "../../plugins/pane-manager";
import { notifyGridlockComplete } from "../../plugins/gridlock-notification";
import { PluginSlot } from "../../react/plugins/plugin-slot";
import { LayoutSwitcherControl, useLayoutSwitcher } from "./layout-switcher";

const GRIDLOCK_TIP_DURATION_MS = 60_000;

type StatusBarEvent = { stopPropagation?: () => void; preventDefault?: () => void };
type HoveredControl = string | null;
type SetHoveredControl = (updater: (current: HoveredControl) => HoveredControl) => void;

export function StatusBar() {
  useThemeColors();
  const { nativePaneChrome } = useUiCapabilities();
  const registry = getSharedRegistry();
  const dispatch = useAppDispatch();
  const statusBarVisible = useAppSelector(selectStatusBarVisible);
  const gridlockTipVisible = useAppSelector(selectGridlockTipVisible);
  const gridlockTipSequence = useAppSelector(selectGridlockTipSequence);
  const { activeLayoutIdx, openLayoutContextMenu } = useLayoutSwitcher();
  const [hoveredControl, setHoveredControl] = useState<string | null>(null);

  const showGridlockTip = gridlockTipVisible && !!registry;

  useEffect(() => {
    if (!gridlockTipVisible) return;
    const timer = setTimeout(() => {
      dispatch({ type: "DISMISS_GRIDLOCK_TIP" });
    }, GRIDLOCK_TIP_DURATION_MS);
    return () => clearTimeout(timer);
  }, [dispatch, gridlockTipSequence, gridlockTipVisible]);

  const handleGridlockTip = (event?: StatusBarEvent) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!registry) return;
    const { width, height } = registry.getTermSizeFn();
    registry.updateLayoutFn(gridlockAllPanes(
      registry.getLayoutFn(),
      { x: 0, y: 0, width, height },
      registry.panes,
    ));
    notifyGridlockComplete(registry.notify.bind(registry), () => {
      dispatch({ type: "UNDO_LAYOUT" });
    });
    dispatch({ type: "DISMISS_GRIDLOCK_TIP" });
  };

  const dismissGridlockTip = (event?: StatusBarEvent) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    dispatch({ type: "DISMISS_GRIDLOCK_TIP" });
  };

  if (!statusBarVisible) return null;

  return (
    <Box
      flexDirection="row"
      height={1}
      alignItems="center"
      backgroundColor={colors.panel}
      data-gloom-role="status-bar"
      onContextMenu={(event: any) => {
        void openLayoutContextMenu(activeLayoutIdx, event);
      }}
      {...(nativePaneChrome ? {
        style: {
          borderTop: `1px solid ${colors.border}`,
          boxShadow: `inset 0 1px 0 ${blendHex(colors.panel, colors.textBright, 0.03)}`,
          paddingInline: 8,
          overflow: "visible",
        },
      } : {})}
    >
      {!nativePaneChrome && (
        <Box paddingLeft={1} flexDirection="row" alignItems="center">
          <LayoutSwitcherControl placement="status-bar" />
        </Box>
      )}
      {showGridlockTip && (
        nativePaneChrome ? (
          <NativeGridlockTip
            dismissGridlockTip={dismissGridlockTip}
            handleGridlockTip={handleGridlockTip}
            hoveredControl={hoveredControl}
            setHoveredControl={setHoveredControl}
          />
        ) : (
          <TerminalGridlockTip
            dismissGridlockTip={dismissGridlockTip}
            handleGridlockTip={handleGridlockTip}
            hoveredControl={hoveredControl}
            setHoveredControl={setHoveredControl}
          />
        )
      )}
      <StatusBarWidgets />
    </Box>
  );
}

function NativeGridlockTip({
  dismissGridlockTip,
  handleGridlockTip,
  hoveredControl,
  setHoveredControl,
}: {
  dismissGridlockTip: (event?: StatusBarEvent) => void;
  handleGridlockTip: (event?: StatusBarEvent) => void;
  hoveredControl: HoveredControl;
  setHoveredControl: SetHoveredControl;
}) {
  return (
    <Box paddingLeft={2} flexShrink={0} flexDirection="row" alignItems="center" gap={1}>
      <Text fg={colors.textDim}>{t("Snapped a window?")}</Text>
      <Text
        fg={hoveredControl === "gridlock-tip" ? colors.textBright : colors.borderFocused}
        attributes={TextAttributes.BOLD}
        onMouseOver={() => setHoveredControl((current) => (current === "gridlock-tip" ? current : "gridlock-tip"))}
        onMouseDown={handleGridlockTip}
        data-gloom-interactive="true"
      >
        {t("Gridlock All")}
      </Text>
      <Text
        fg={hoveredControl === "gridlock-tip-dismiss" ? colors.text : colors.textDim}
        onMouseOver={() => setHoveredControl((current) => (current === "gridlock-tip-dismiss" ? current : "gridlock-tip-dismiss"))}
        onMouseDown={dismissGridlockTip}
        data-gloom-interactive="true"
      >
        {t("Dismiss")}
      </Text>
    </Box>
  );
}

function TerminalGridlockTip({
  dismissGridlockTip,
  handleGridlockTip,
  hoveredControl,
  setHoveredControl,
}: {
  dismissGridlockTip: (event?: StatusBarEvent) => void;
  handleGridlockTip: (event?: StatusBarEvent) => void;
  hoveredControl: HoveredControl;
  setHoveredControl: SetHoveredControl;
}) {
  return (
    <Box paddingLeft={1} flexShrink={0} flexDirection="row">
      <Text fg={colors.textDim}>{t("Snapped a window?")}</Text>
      <Box width={1} />
      <Box
        backgroundColor={hoveredControl === "gridlock-tip" ? hoverBg() : colors.header}
        onMouseOver={() => setHoveredControl((current) => (current === "gridlock-tip" ? current : "gridlock-tip"))}
        onMouseDown={handleGridlockTip}
      >
        <Text fg={colors.headerText}> {t("Gridlock All")} </Text>
      </Box>
      <Text
        fg={hoveredControl === "gridlock-tip-dismiss" ? colors.text : colors.textDim}
        onMouseOver={() => setHoveredControl((current) => (current === "gridlock-tip-dismiss" ? current : "gridlock-tip-dismiss"))}
        onMouseDown={dismissGridlockTip}
      >
        {" x"}
      </Text>
    </Box>
  );
}

function openChangelog(event?: StatusBarEvent) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  getSharedRegistry()?.createPaneFromTemplate("changelog-pane");
}

function StatusBarVersion({ nativePaneChrome }: { nativePaneChrome: boolean }) {
  const [hovered, setHovered] = useState(false);
  const handleKeyDown = (event: { key?: string; preventDefault?: () => void }) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault?.();
    openChangelog();
  };

  return (
    <Box
      alignItems="center"
      onMouseOver={() => setHovered((current) => (current ? current : true))}
      onMouseOut={() => setHovered((current) => (current ? false : current))}
      onMouseDown={openChangelog}
      onKeyDown={nativePaneChrome ? handleKeyDown : undefined}
      data-gloom-role="status-version"
      data-gloom-interactive="true"
      aria-label="Open changelog"
      title="Changelog"
      role={nativePaneChrome ? "button" : undefined}
      tabIndex={nativePaneChrome ? 0 : undefined}
      {...(nativePaneChrome ? {
        style: {
          cursor: "pointer",
          borderRadius: 4,
          paddingInline: 4,
        },
      } : {
        height: 1,
        paddingRight: 1,
      })}
    >
      <Text fg={hovered ? colors.text : colors.textDim}>v{VERSION}</Text>
    </Box>
  );
}

function StatusBarWidgets() {
  const { nativePaneChrome } = useUiCapabilities();
  return (
    <>
      <Box flexGrow={1} />
      {nativePaneChrome ? (
        <Box
          flexDirection="row"
          alignItems="center"
          flexShrink={0}
          data-gloom-role="status-chip"
          style={{
            gap: 8,
            paddingInline: 8,
            borderRadius: 6,
            overflow: "visible",
            backgroundColor: blendHex(colors.panel, colors.header, 0.28),
          }}
        >
          <StatusBarVersion nativePaneChrome />
          <PluginSlot name="status:widget" />
        </Box>
      ) : (
        <>
          <StatusBarVersion nativePaneChrome={false} />
          <PluginSlot name="status:widget" />
        </>
      )}
    </>
  );
}
