import { getDockedPaneIds } from "../../../pane-manager";
import { resolveTickerForPane, type AppState } from "../../../../state/app/context";
import { formatLiveDeskContext, type LiveDeskSnapshot } from "./model";

export function selectLiveDeskContext(state: AppState): string {
  return formatLiveDeskContext(liveDeskSnapshotFromState(state));
}

export function liveDeskSnapshotFromState(state: AppState): LiveDeskSnapshot {
  const layout = state.config.layout;
  const docked = new Set(getDockedPaneIds(layout));
  const floating = new Set(layout.floating.map((entry) => entry.instanceId));
  const detached = new Set((layout.detached ?? []).map((entry) => entry.instanceId));
  return {
    layoutName: state.config.layouts[state.config.activeLayoutIndex]?.name ?? null,
    focusedPaneId: state.focusedPaneId,
    panes: layout.instances.map((pane) => {
      const ticker = resolveTickerForPane(state, pane.instanceId);
      const placement = docked.has(pane.instanceId)
        ? "docked" as const
        : floating.has(pane.instanceId)
          ? "floating" as const
          : detached.has(pane.instanceId)
            ? "detached" as const
            : "hidden" as const;
      return {
        instanceId: pane.instanceId,
        paneId: pane.paneId,
        ...(pane.title ? { title: pane.title } : {}),
        placement,
        focused: state.focusedPaneId === pane.instanceId,
        ...(ticker ? { ticker } : {}),
      };
    }),
  };
}
