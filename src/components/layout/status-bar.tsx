import { Box, Text, TextAttributes, useUiCapabilities } from "../../ui";
import { useEffect, useState } from "react";
import { blendHex, colors, hoverBg } from "../../theme/colors";
import { t } from "../../i18n";
import { useThemeColors } from "../../theme/theme-context";
import { useAppDispatch, useAppSelector } from "../../state/app/context";
import { VERSION } from "../../version";
import {
  selectActiveLayoutIndex,
  selectGridlockTipSequence,
  selectGridlockTipVisible,
  selectSavedLayouts,
  selectStatusBarVisible,
} from "../../state/selectors-ui";
import { getSharedRegistry } from "../../plugins/registry";
import { gridlockAllPanes } from "../../plugins/pane-manager";
import { notifyGridlockComplete } from "../../plugins/gridlock-notification";
import { PluginSlot } from "../../react/plugins/plugin-slot";
import { useLayoutSwitcher } from "./layout-switcher";
import { resolveAppStatusBarHeightCells } from "./shell/chrome";

const GRIDLOCK_TIP_DURATION_MS = 60_000;
const LAYOUT_CHIP_DIGIT_LIMIT = 9;

function layoutChipLabel(index: number, name: string): string {
  const slot = index + 1;
  return slot <= LAYOUT_CHIP_DIGIT_LIMIT ? `${slot} ${name}` : name;
}

type StatusBarEvent = { stopPropagation?: () => void; preventDefault?: () => void };
type HoveredControl = string | null;
type SetHoveredControl = (updater: (current: HoveredControl) => HoveredControl) => void;

export function StatusBar() {
  useThemeColors();
  const { nativePaneChrome, cellHeightPx } = useUiCapabilities();
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
      height={resolveAppStatusBarHeightCells({
        visible: true,
        nativePaneChrome,
        cellHeightPx,
      })}
      flexShrink={0}
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
      {nativePaneChrome ? (
        <NativeLayoutChips
          hoveredControl={hoveredControl}
          setHoveredControl={setHoveredControl}
        />
      ) : (
        <TerminalLayoutChips
          hoveredControl={hoveredControl}
          setHoveredControl={setHoveredControl}
        />
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

function useStatusBarLayouts() {
  const dispatch = useAppDispatch();
  const layouts = useAppSelector(selectSavedLayouts);
  const activeLayoutIdx = useAppSelector(selectActiveLayoutIndex);
  const { openLayoutContextMenu } = useLayoutSwitcher();

  const switchLayout = (index: number, event?: StatusBarEvent) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (index === activeLayoutIdx) return;
    dispatch({ type: "SWITCH_LAYOUT", index });
  };

  const openChipContextMenu = (index: number, event?: StatusBarEvent) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    void openLayoutContextMenu(index, event ?? {});
  };

  return { layouts, activeLayoutIdx, switchLayout, openChipContextMenu };
}

function NativeLayoutChips({
  hoveredControl,
  setHoveredControl,
}: {
  hoveredControl: HoveredControl;
  setHoveredControl: SetHoveredControl;
}) {
  const { layouts, activeLayoutIdx, switchLayout, openChipContextMenu } = useStatusBarLayouts();
  if (layouts.length === 0) return null;

  return (
    <Box
      flexShrink={0}
      flexDirection="row"
      alignItems="center"
      data-gloom-role="status-layouts"
      style={{ gap: 4 }}
    >
      {layouts.map((layout, index) => {
        const active = index === activeLayoutIdx;
        const hoverKey = `layout-${index}`;
        const hovered = hoveredControl === hoverKey;
        return (
          <Box
            key={`${layout.id ?? layout.name}-${index}`}
            alignItems="center"
            onMouseOver={() => setHoveredControl((current) => (current === hoverKey ? current : hoverKey))}
            onMouseOut={() => setHoveredControl((current) => (current === hoverKey ? null : current))}
            onMouseDown={(event: StatusBarEvent) => switchLayout(index, event)}
            onContextMenu={(event: StatusBarEvent) => openChipContextMenu(index, event)}
            data-gloom-role="status-layout"
            data-gloom-interactive="true"
            aria-label={layout.name}
            title={layout.name}
            role="button"
            tabIndex={0}
            style={{
              cursor: "pointer",
              borderRadius: 4,
              paddingInline: 6,
              paddingBlock: 1,
              backgroundColor: active
                ? blendHex(colors.panel, colors.header, 0.42)
                : hovered
                  ? blendHex(colors.panel, colors.header, 0.22)
                  : "transparent",
            }}
          >
            <Text
              fg={active ? colors.textBright : hovered ? colors.text : colors.textDim}
              attributes={active ? TextAttributes.BOLD : undefined}
            >
              {layoutChipLabel(index, layout.name)}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

function TerminalLayoutChips({
  hoveredControl,
  setHoveredControl,
}: {
  hoveredControl: HoveredControl;
  setHoveredControl: SetHoveredControl;
}) {
  const { layouts, activeLayoutIdx, switchLayout, openChipContextMenu } = useStatusBarLayouts();
  if (layouts.length === 0) return null;

  return (
    <Box
      paddingLeft={1}
      flexShrink={0}
      flexDirection="row"
      alignItems="center"
      data-gloom-role="status-layouts"
    >
      {layouts.map((layout, index) => {
        const active = index === activeLayoutIdx;
        const hoverKey = `layout-${index}`;
        const hovered = hoveredControl === hoverKey;
        const label = layoutChipLabel(index, layout.name);
        return (
          <Box
            key={`${layout.id ?? layout.name}-${index}`}
            flexDirection="row"
            onMouseOver={() => setHoveredControl((current) => (current === hoverKey ? current : hoverKey))}
            onMouseDown={(event: StatusBarEvent) => switchLayout(index, event)}
            onContextMenu={(event: StatusBarEvent) => openChipContextMenu(index, event)}
            data-gloom-role="status-layout"
            data-gloom-interactive="true"
          >
            {index > 0 ? <Box width={1} /> : null}
            <Box backgroundColor={hovered && !active ? hoverBg() : undefined}>
              <Text
                fg={active ? colors.textBright : hovered ? colors.text : colors.textDim}
                attributes={active ? TextAttributes.BOLD : undefined}
              >
                {label}
              </Text>
            </Box>
          </Box>
        );
      })}
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
