import { Box, Span, Text, TextAttributes, contextMenuDivider, useContextMenu, useUiCapabilities } from "../../ui";
import { useDialog, type PromptContext } from "../../ui/dialog";
import { useCallback, useMemo, useState } from "react";
import { blendHex, hoverBg } from "../../theme/colors";
import { t, tf } from "../../i18n";
import { useThemeColors } from "../../theme/theme-context";
import { useAppDispatch, useAppSelector } from "../../state/app/context";
import { VERSION } from "../../version";
import {
  selectActiveLayoutIndex,
  selectLayout,
  selectSavedLayouts,
  selectStatusBarVisible,
} from "../../state/selectors-ui";
import { getSharedRegistry } from "../../plugins/registry";
import {
  gridlockAllPanes,
  shouldShowTidyWindows,
} from "../../plugins/pane-manager";
import { notifyGridlockComplete } from "../../plugins/gridlock-notification";
import { PluginSlot } from "../../react/plugins/plugin-slot";
import type { ContextMenuItem } from "../../types/context-menu";
import type { LayoutConfig } from "../../types/config";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Tabs } from "../ui/tabs";
import { useTransientLayout } from "./transient-layout";
import { resolveAppStatusBarHeightCells } from "./shell/chrome";

type StatusBarEvent = { stopPropagation?: () => void; preventDefault?: () => void };
type HoveredControl = string | null;
type SetHoveredControl = (updater: (current: HoveredControl) => HoveredControl) => void;

type LayoutTabItem = {
  label: string;
  value: string;
  reorderable?: boolean;
  onContextMenu: (value: string, event: any) => void;
};

type StatusBarViewProps = {
  activeLayoutIdx: number;
  activeLayoutValue: string;
  handleLayoutReorder: (fromValue: string, toValue: string) => void;
  handleLayoutSelect: (value: string) => void;
  handleTidyWindows: (event?: StatusBarEvent) => void;
  hasMultipleLayouts: boolean;
  hoveredControl: HoveredControl;
  layoutTabItems: LayoutTabItem[];
  layoutTabsWidth: number;
  openCommandBar: (event?: StatusBarEvent) => void;
  openLayoutContextMenu: (index: number, event: any) => void | Promise<unknown>;
  setHoveredControl: SetHoveredControl;
  showTidyWindows: boolean;
};

function truncate(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width <= 2) return ".".repeat(width);
  return `${text.slice(0, width - 2)}..`;
}

export function StatusBar() {
  useThemeColors();
  const { nativePaneChrome, cellHeightPx } = useUiCapabilities();
  const registry = getSharedRegistry();
  const dispatch = useAppDispatch();
  const statusBarVisible = useAppSelector(selectStatusBarVisible);
  const layout = useAppSelector(selectLayout);
  const { transientLayout } = useTransientLayout();
  const { activeLayoutIdx, openLayoutContextMenu } = useLayoutSwitcher();
  const [hoveredControl, setHoveredControl] = useState<string | null>(null);

  const hasMultipleLayouts = layouts.length > 1 || !!transientLayout;
  const showTidyWindows = useMemo(() => shouldShowTidyWindows(layout), [layout])
    && !transientLayout?.active
    && !!registry;
  const savedLayoutTabs = layouts.map((layout, index) => ({
    label: `^${index + 1} ${truncate(layout.name, 14)}`,
    value: String(index),
    reorderable: true,
  }));
  const layoutTabs = transientLayout
    ? [
      ...savedLayoutTabs,
      {
        label: transientLayout.label,
        value: transientLayout.id,
        reorderable: false,
      },
    ]
    : savedLayoutTabs;
  const layoutTabsWidth = layoutTabs.reduce((sum, tab) => sum + tab.label.length + 2, 0);
  const activeLayoutValue = transientLayout?.active ? transientLayout.id : String(activeLayoutIdx);
  const handleLayoutSelect = (value: string) => {
    if (value === transientLayout?.id) {
      if (transientLayout.active) {
        transientLayout.onExit?.();
      } else {
        transientLayout.onActivate?.();
      }
      return;
    }
    const index = Number(value);
    if (!Number.isInteger(index) || index < 0 || index >= layouts.length) return;
    if (transientLayout?.active) {
      transientLayout.onDeactivate?.();
    }
    dispatch({ type: "SWITCH_LAYOUT", index });
  };
  const handleLayoutReorder = (fromValue: string, toValue: string) => {
    const fromIndex = Number(fromValue);
    const toIndex = Number(toValue);
    if (
      !Number.isInteger(fromIndex)
      || !Number.isInteger(toIndex)
      || fromIndex < 0
      || toIndex < 0
      || fromIndex >= layouts.length
      || toIndex >= layouts.length
      || fromIndex === toIndex
    ) return;
    dispatch({ type: "REORDER_LAYOUT", fromIndex, toIndex });
  };

  const handleTidyWindows = (event?: StatusBarEvent) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!registry) return;

    const currentLayout = registry.getLayoutFn();
    const { width, height } = registry.getTermSizeFn();
    const nextLayout = gridlockAllPanes(
      currentLayout,
      { x: 0, y: 0, width, height },
      registry.panes,
    );
    if (nextLayout === currentLayout) return;

    registry.updateLayoutFn(nextLayout);
    notifyGridlockComplete(registry.notify.bind(registry), () => {
      dispatch({ type: "UNDO_LAYOUT" });
    });
  };

  const openCommandBar = (event?: StatusBarEvent) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    dispatch({ type: "SET_COMMAND_BAR", open: true, query: "" });
  };

  const requestDeleteLayout = useCallback(async (index: number) => {
    const layout = layouts[index];
    if (!layout || layouts.length <= 1) return;
    const confirmed = await dialog.prompt<boolean>({
      closeOnClickOutside: true,
      content: (context: PromptContext<boolean>) => (
        <ConfirmDialog
          {...context}
          title={t("Delete Layout")}
          body={[`Delete layout "${layout.name}"? This cannot be undone.`]}
          confirmLabel={t("Delete Layout")}
          cancelLabel={t("Cancel")}
          width={48}
        />
      ),
    }).catch(() => false);
    if (confirmed !== true) return;
    dispatch({ type: "DELETE_LAYOUT", index });
    registry?.notify({ body: `Layout "${layout.name}" deleted`, type: "success" });
  }, [dialog, dispatch, layouts, registry]);

  const layoutContextMenuItems = useCallback((index: number): ContextMenuItem[] => {
    const layout = layouts[index];
    if (!layout) return [];
    const active = index === activeLayoutIdx;
    const switchToLayout = () => {
      if (!active) {
        dispatch({ type: "SWITCH_LAYOUT", index });
      }
    };
    const openWorkflowForLayout = (commandId: string) => {
      switchToLayout();
      registry?.openPluginCommandWorkflow(commandId);
    };
    const items: ContextMenuItem[] = [];

    if (!active) {
      items.push({
        id: "layout:switch",
        label: tf("Switch to {name}", { name: layout.name }),
        onSelect: () => dispatch({ type: "SWITCH_LAYOUT", index }),
      });
      items.push(contextMenuDivider("layout:switch-divider"));
    }

    items.push(
      {
        id: "layout:rename",
        label: "Rename Layout...",
        onSelect: () => openWorkflowForLayout("rename-layout"),
      },
      {
        id: "layout:duplicate",
        label: "Duplicate Layout",
        onSelect: () => dispatch({ type: "DUPLICATE_LAYOUT", index }),
      },
      {
        id: "layout:new",
        label: "New Layout...",
        onSelect: () => registry?.openPluginCommandWorkflow("new-layout"),
      },
      {
        id: "layout:delete",
        label: "Delete Layout...",
        enabled: layouts.length > 1,
        onSelect: () => requestDeleteLayout(index),
      },
      contextMenuDivider("layout:actions-divider"),
      {
        id: "layout:gallery",
        label: "Browse Layouts...",
        onSelect: () => registry?.showPane("layout-marketplace"),
      },
      {
        id: "layout:actions",
        label: "Layout Actions...",
        onSelect: () => registry?.openCommandBar("LMA "),
      },
    );

    return items;
  }, [activeLayoutIdx, dispatch, layouts, registry, requestDeleteLayout]);

  const openLayoutContextMenu = useCallback((
    index: number,
    event: { preventDefault?: () => void; stopPropagation?: () => void },
  ) => {
    const layout = layouts[index];
    if (!layout) return Promise.resolve(false);
    return showContextMenu(
      {
        kind: "layout",
        layoutIndex: index,
        layoutName: layout.name,
        active: index === activeLayoutIdx,
      },
      layoutContextMenuItems(index),
      event,
    );
  }, [activeLayoutIdx, layoutContextMenuItems, layouts, showContextMenu]);
  const handleLayoutTabContextMenu = useCallback((value: string, event: any) => {
    if (value === transientLayout?.id) return;
    const index = Number(value);
    if (!Number.isInteger(index) || index < 0 || index >= layouts.length) return;
    if (event?.type !== "contextmenu" && event?.button === 2 && nativeContextMenu === true) return;
    void openLayoutContextMenu(index, event);
  }, [layouts.length, nativeContextMenu, openLayoutContextMenu, transientLayout?.id]);
  const layoutTabItems = layoutTabs.map((tab) => ({
    ...tab,
    onContextMenu: handleLayoutTabContextMenu,
  }));

  if (!statusBarVisible) return null;

  const viewProps: StatusBarViewProps = {
    activeLayoutIdx,
    activeLayoutValue,
    handleLayoutReorder,
    handleLayoutSelect,
    handleTidyWindows,
    hasMultipleLayouts,
    hoveredControl,
    layoutTabItems,
    layoutTabsWidth,
    openCommandBar,
    openLayoutContextMenu,
    setHoveredControl,
    showTidyWindows,
  };

  const openChipContextMenu = (index: number, event?: StatusBarEvent) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    void openLayoutContextMenu(index, event ?? {});
  };

  return { layouts, activeLayoutIdx, switchLayout, openChipContextMenu };
}

function NativeStatusBar({
  activeLayoutIdx,
  openLayoutContextMenu,
  showTidyWindows,
  ...props
}: StatusBarViewProps) {
  const colors = useThemeColors();
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
      style={{
        borderTop: `1px solid ${colors.border}`,
        boxShadow: `inset 0 1px 0 ${blendHex(colors.panel, colors.textBright, 0.03)}`,
        paddingInline: 8,
      }}
    >
      <StatusBarLayoutControl nativePaneChrome {...props} />
      {showTidyWindows && <NativeTidyWindows {...props} />}
      <StatusBarWidgets />
    </Box>
  );
}

function TerminalStatusBar({
  activeLayoutIdx,
  openLayoutContextMenu,
  showTidyWindows,
  ...props
}: StatusBarViewProps) {
  const colors = useThemeColors();
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
    >
      <StatusBarLayoutControl nativePaneChrome={false} {...props} />
      {showTidyWindows && <TerminalTidyWindows {...props} />}
      <StatusBarWidgets />
    </Box>
  );
}

function StatusBarLayoutControl({
  activeLayoutValue,
  handleLayoutSelect,
  handleLayoutReorder,
  hasMultipleLayouts,
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

function NativeTidyWindows({
  handleTidyWindows,
  hoveredControl,
  setHoveredControl,
}: {
  handleTidyWindows: (event?: StatusBarEvent) => void;
  hoveredControl: HoveredControl;
  setHoveredControl: SetHoveredControl;
}) {
  const hovered = hoveredControl === "tidy-windows";
  return (
    <Text
      fg={hovered ? colors.text : colors.textDim}
      {...(!nativePaneChrome ? { bg: hovered ? hoverBg(colors) : undefined } : {})}
      onMouseOver={() => setHoveredControl((current) => (current === "command-bar" ? current : "command-bar"))}
      onMouseDown={openCommandBar}
      {...(nativePaneChrome ? { "data-gloom-interactive": "true" } : {})}
    >
      <Span fg={colors.text}>Ctrl+P</Span> {t("command bar")}
    </Text>
  );
}

function NativeTidyWindows({
  handleTidyWindows,
  hoveredControl,
  setHoveredControl,
}: Pick<StatusBarViewProps, "handleTidyWindows" | "hoveredControl" | "setHoveredControl">) {
  const colors = useThemeColors();
  const hovered = hoveredControl === "tidy-windows";
  return (
    <Box paddingLeft={2} flexShrink={0} flexDirection="row" alignItems="center">
      <Text
        fg={hovered ? colors.textBright : colors.borderFocused}
        attributes={TextAttributes.BOLD}
        title={t("Tidy Windows")}
        onMouseOver={() => setHoveredControl((current) => (current === "tidy-windows" ? current : "tidy-windows"))}
        onMouseDown={handleTidyWindows}
        data-gloom-interactive="true"
      >
        {t("Tidy Windows")}
      </Text>
    </Box>
  );
}

function TerminalTidyWindows({
  handleTidyWindows,
  hoveredControl,
  setHoveredControl,
}: Pick<StatusBarViewProps, "handleTidyWindows" | "hoveredControl" | "setHoveredControl">) {
  const colors = useThemeColors();
  const hovered = hoveredControl === "tidy-windows";
  return (
    <Box paddingLeft={1} flexShrink={0} flexDirection="row">
      <Box
        backgroundColor={hovered ? hoverBg(colors) : colors.header}
        onMouseOver={() => setHoveredControl((current) => (current === "tidy-windows" ? current : "tidy-windows"))}
        onMouseDown={handleTidyWindows}
      >
        <Text fg={colors.headerText}> {t("Tidy Windows")} </Text>
      </Box>
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
