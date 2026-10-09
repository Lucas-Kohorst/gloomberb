import {
  findPaneInstance,
  isTickerPaneId,
  normalizePaneId,
  resolvePaneInstance,
  type LayoutConfig,
  type PaneInstanceConfig,
} from "../../types/config";

export function isCollectionPaneInstance(instance: PaneInstanceConfig): boolean {
  return instance.paneId === "portfolio-list";
}

export function isTickerContextPaneInstance(instance: PaneInstanceConfig): boolean {
  return instance.paneId === "portfolio-list" || isTickerPaneId(instance.paneId);
}

export function resolvePaneTarget(layout: LayoutConfig, paneId: string): string | null {
  return resolvePaneInstance(layout, normalizePaneId(paneId))?.instanceId
    ?? resolvePaneInstance(layout, paneId)?.instanceId
    ?? null;
}

/** Resolve an instance id before looking up its registered pane type. */
export function resolvePaneShowTarget(
  layout: LayoutConfig,
  paneId: string,
): { paneType: string; instance: PaneInstanceConfig | null } {
  const instanceId = resolvePaneTarget(layout, paneId);
  const instance = instanceId ? findPaneInstance(layout, instanceId) ?? null : null;
  return {
    paneType: normalizePaneId(instance?.paneId ?? paneId),
    instance,
  };
}
