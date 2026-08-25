import { Box, Text, contextMenuDivider, useContextMenu, useUiCapabilities, useUiHost } from "../../ui";
import { formatLayoutSwitchShortcutHint, layoutSwitchUsesOption } from "../../utils/layout-switch-shortcut";
import { useDialog, type PromptContext } from "../../ui/dialog";
import { useCallback, useState } from "react";
import { blendHex, colors, hoverBg } from "../../theme/colors";
import { t, tf } from "../../i18n";
import { useAppDispatch, useAppSelector } from "../../state/app/context";
import {
  selectActiveLayoutIndex,
  selectSavedLayouts,
} from "../../state/selectors-ui";
import { getSharedRegistry } from "../../plugins/registry";
import type { ContextMenuItem } from "../../types/context-menu";
import { Tabs } from "../ui/tabs";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { useTransientLayout } from "./transient-layout";

type StatusBarEvent = { stopPropagation?: () => void; preventDefault?: () => void };

type LayoutTabItem = {
  label: string;
  value: string;
  reorderable?: boolean;
  onContextMenu: (value: string, event: any) => void;
};

function truncate(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width <= 2) return ".".repeat(width);
  return `${text.slice(0, width - 2)}..`;
}

function stopChromeMouse(event?: StatusBarEvent) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
}

export function useLayoutSwitcher() {
  const uiHost = useUiHost();
  const { nativeContextMenu, nativePaneChrome } = useUiCapabilities();
  const { showContextMenu } = useContextMenu();
  const dialog = useDialog();
  const registry = getSharedRegistry();
  const dispatch = useAppDispatch();
  const layouts = useAppSelector(selectSavedLayouts);
  const activeLayoutIdx = useAppSelector(selectActiveLayoutIndex);
  const { transientLayout } = useTransientLayout();
  const optionLayoutSwitch = layoutSwitchUsesOption({
    kind: uiHost.kind,
    nativePaneChrome,
  });

  const hasMultipleLayouts = layouts.length > 1 || !!transientLayout;
  const savedLayoutTabs = layouts.map((layout, index) => ({
    label: `${formatLayoutSwitchShortcutHint(index + 1, optionLayoutSwitch)} ${truncate(layout.name, 14)}`,
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

  const openLayouts = (event?: StatusBarEvent) => {
    stopChromeMouse(event);
    dispatch({ type: "SET_COMMAND_BAR", open: true, query: "LAY " });
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
        id: "layout:actions",
        label: "Layout Actions...",
        onSelect: () => registry?.openCommandBar("LAY "),
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

  return {
    activeLayoutIdx,
    activeLayoutValue,
    handleLayoutReorder,
    handleLayoutSelect,
    hasMultipleLayouts,
    layoutTabItems,
    layoutTabsWidth,
    openLayoutContextMenu,
    openLayouts,
  };
}

export function LayoutSwitcherControl() {
  const { nativePaneChrome = false } = useUiCapabilities();
  const [hoveredControl, setHoveredControl] = useState<string | null>(null);
  const {
    activeLayoutValue,
    handleLayoutReorder,
    handleLayoutSelect,
    hasMultipleLayouts,
    layoutTabItems,
    layoutTabsWidth,
    openLayouts,
  } = useLayoutSwitcher();

  return (
    <Box
      flexShrink={0}
      flexDirection="row"
      alignItems="center"
      minWidth={0}
      data-gloom-role="layout-switcher"
      {...(nativePaneChrome ? { gap: 1 } : {})}
    >
      {hasMultipleLayouts ? (
        <Box
          height={1}
          minWidth={0}
          overflow="hidden"
          {...(nativePaneChrome ? { flexShrink: 1 } : { width: layoutTabsWidth, flexShrink: 0 })}
        >
          <Tabs
            tabs={layoutTabItems}
            activeValue={activeLayoutValue}
            onSelect={handleLayoutSelect}
            onReorder={handleLayoutReorder}
            compact
            variant="pill"
          />
        </Box>
      ) : null}
      <LayoutsButton
        hovered={hoveredControl === "layouts"}
        nativePaneChrome={nativePaneChrome}
        openLayouts={openLayouts}
        onHover={(hovered) => setHoveredControl(hovered ? "layouts" : null)}
      />
    </Box>
  );
}

function LayoutsButton({
  hovered,
  nativePaneChrome,
  openLayouts,
  onHover,
}: {
  hovered: boolean;
  nativePaneChrome: boolean;
  openLayouts: (event?: StatusBarEvent) => void;
  onHover: (hovered: boolean) => void;
}) {
  const handleKeyDown = (event: { key?: string; preventDefault?: () => void; stopPropagation?: () => void }) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    openLayouts(event);
  };

  return (
    <Box
      height={1}
      alignItems="center"
      flexShrink={0}
      onMouseOver={() => onHover(true)}
      onMouseOut={() => onHover(false)}
      onMouseDown={openLayouts}
      onKeyDown={nativePaneChrome ? handleKeyDown : undefined}
      data-gloom-role="layout-presets-button"
      data-gloom-interactive="true"
      aria-label="Open layout presets"
      title="Layouts and presets"
      role={nativePaneChrome ? "button" : undefined}
      tabIndex={nativePaneChrome ? 0 : undefined}
      {...(nativePaneChrome ? {
        style: {
          cursor: "pointer",
          borderRadius: 6,
          paddingInline: 6,
          backgroundColor: hovered ? hoverBg() : blendHex(colors.panel, colors.header, 0.18),
        },
      } : {
        marginLeft: 1,
        backgroundColor: hovered ? hoverBg() : colors.header,
      })}
    >
      <Text fg={nativePaneChrome ? (hovered ? colors.textBright : colors.text) : colors.headerText}>
        {nativePaneChrome ? "Layouts" : " Layouts "}
      </Text>
    </Box>
  );
}
