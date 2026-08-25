import { contextMenuDivider, useContextMenu } from "../../ui";
import { useDialog, type PromptContext } from "../../ui/dialog";
import { useCallback } from "react";
import { t, tf } from "../../i18n";
import { useAppDispatch, useAppSelector } from "../../state/app/context";
import {
  selectActiveLayoutIndex,
  selectSavedLayouts,
} from "../../state/selectors-ui";
import { getSharedRegistry } from "../../plugins/registry";
import type { ContextMenuItem } from "../../types/context-menu";
import { ConfirmDialog } from "../ui/confirm-dialog";

export function useLayoutSwitcher() {
  const { showContextMenu } = useContextMenu();
  const dialog = useDialog();
  const registry = getSharedRegistry();
  const dispatch = useAppDispatch();
  const layouts = useAppSelector(selectSavedLayouts);
  const activeLayoutIdx = useAppSelector(selectActiveLayoutIndex);

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

  return {
    activeLayoutIdx,
    openLayoutContextMenu,
  };
}
