import {
  addPaneFloating,
  dockPane,
  finalizeLayout,
} from "../../../plugins/pane-manager";
import type { PaneDef } from "../../../types/plugin";
import {
  cloneLayout,
  createPaneInstance,
  findPaneInstance,
  type LayoutConfig,
  type PaneInstanceConfig,
} from "../../../types/config";
import type { ClosedPane, PaneRuntimeState } from "./types";

export const MAX_CLOSED_PANES = 10;

function clonePaneState(paneState: PaneRuntimeState): PaneRuntimeState {
  return structuredClone(paneState);
}

export function pushClosedPane(stack: readonly ClosedPane[], pane: ClosedPane): ClosedPane[] {
  return [...stack, pane].slice(-MAX_CLOSED_PANES);
}

export function popClosedPane(stack: readonly ClosedPane[]): {
  pane: ClosedPane | null;
  stack: ClosedPane[];
} {
  return {
    pane: stack.at(-1) ?? null,
    stack: stack.slice(0, -1),
  };
}

export function captureClosedPane(
  layout: LayoutConfig,
  paneId: string,
  paneState: PaneRuntimeState | undefined,
): ClosedPane | null {
  const prepared = finalizeLayout(cloneLayout(layout));
  const instance = findPaneInstance(prepared, paneId);
  if (!instance) return null;
  return {
    instance: createPaneInstance(instance.paneId, instance),
    paneState: clonePaneState(paneState ?? {}),
  };
}

export function restoreClosedPane(
  layout: LayoutConfig,
  closedPane: ClosedPane,
  width: number,
  height: number,
  paneDef?: PaneDef,
): LayoutConfig {
  const instance: PaneInstanceConfig = createPaneInstance(
    closedPane.instance.paneId,
    closedPane.instance,
  );
  if (instance.placementMemory?.floating) {
    return addPaneFloating(layout, instance, width, height, paneDef);
  }
  return dockPane({
    ...layout,
    instances: [...layout.instances, instance],
  }, instance.instanceId);
}
