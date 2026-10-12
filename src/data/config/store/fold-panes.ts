import {
  removePaneInstances,
  type DockLayoutNode,
  type LayoutConfig,
  type PaneInstanceConfig,
} from "../../../types/config";
import { isRecord } from "../../../utils/guards";

const SHORT_VOLUME_PANE_ID = "short-volume";
const SHORT_INTEREST_PANE_ID = "short-interest";
const SOVR_PANE_ID = "sovr-board";
const CDX_PANE_ID = "cdx-board";
const COMMODITIES_ENERGY_PANE_ID = "commodities-energy";
const COMMODITIES_ENERGY_TABS: Readonly<Record<string, string>> = {
  futures: "markets",
  "futures-curve": "curve",
  cot: "positioning",
  doe: "inventories",
  "commodity-balances": "crops",
  jodi: "balances",
  "energy-outlook": "outlook",
};
const COMMODITIES_MODULE_STATE: Readonly<Record<string, string>> = {
  "futures-curve": "market-overview:futures-curve",
  cot: "market-overview:cot",
  doe: "market-overview:doe",
};

interface FoldedLayout {
  layout: LayoutConfig;
  idMap: Map<string, string>;
  removed: Set<string>;
}

function asLayout(value: unknown): LayoutConfig | null {
  if (!isRecord(value) || !Array.isArray(value.instances)) return null;
  return {
    dockRoot: (value.dockRoot ?? null) as DockLayoutNode | null,
    instances: value.instances as PaneInstanceConfig[],
    floating: Array.isArray(value.floating) ? value.floating as LayoutConfig["floating"] : [],
    detached: Array.isArray(value.detached) ? value.detached as LayoutConfig["detached"] : [],
  };
}

function interestInstanceId(instanceId: string): string {
  if (instanceId === SHORT_VOLUME_PANE_ID || instanceId.startsWith(`${SHORT_VOLUME_PANE_ID}:`)) {
    return `${SHORT_INTEREST_PANE_ID}${instanceId.slice(SHORT_VOLUME_PANE_ID.length)}`;
  }
  return instanceId;
}

function mapNode(node: DockLayoutNode | null, idMap: Map<string, string>): DockLayoutNode | null {
  if (!node) return null;
  if (node.kind === "pane") return { ...node, instanceId: idMap.get(node.instanceId) ?? node.instanceId };
  return { ...node, first: mapNode(node.first, idMap)!, second: mapNode(node.second, idMap)! };
}

/** Daily short volume becomes the short interest pane's volume tab, and sovereign CDS the index board's Sovereign tab. */
export function foldPaneLayout(layout: LayoutConfig): FoldedLayout {
  const removed = new Set<string>();
  const idMap = new Map<string, string>();
  const claimed = new Set(layout.instances.map((instance) => instance.instanceId));
  let hasIndexBoard = layout.instances.some((instance) => instance.paneId === CDX_PANE_ID);

  const instances = layout.instances.flatMap((instance) => {
    if (instance.paneId === SOVR_PANE_ID) {
      if (hasIndexBoard) {
        removed.add(instance.instanceId);
        return [];
      }
      hasIndexBoard = true;
      return [{
        ...instance,
        paneId: CDX_PANE_ID,
        params: { ...(instance.params ?? {}), tab: "sovereign" },
      }];
    }
    if (instance.paneId !== SHORT_VOLUME_PANE_ID) return [instance];
    const targetId = interestInstanceId(instance.instanceId);
    const taken = targetId !== instance.instanceId && claimed.has(targetId);
    if (taken) {
      removed.add(instance.instanceId);
      return [];
    }
    if (targetId !== instance.instanceId) {
      claimed.add(targetId);
      idMap.set(instance.instanceId, targetId);
    }
    return [{
      ...instance,
      instanceId: targetId,
      paneId: SHORT_INTEREST_PANE_ID,
      params: { ...(instance.params ?? {}), tab: "volume" },
    }];
  });

  const mapped: LayoutConfig = {
    dockRoot: mapNode(layout.dockRoot, idMap),
    instances: instances.map((instance) => {
      const binding = instance.binding?.kind === "follow"
        ? { ...instance.binding, sourceInstanceId: idMap.get(instance.binding.sourceInstanceId) ?? instance.binding.sourceInstanceId }
        : instance.binding;
      const anchor = instance.placementMemory?.docked?.anchorInstanceId;
      const placementMemory = anchor
        ? {
          ...instance.placementMemory,
          docked: { ...instance.placementMemory?.docked, anchorInstanceId: idMap.get(anchor) ?? anchor },
        }
        : instance.placementMemory;
      return { ...instance, binding, placementMemory };
    }),
    floating: layout.floating.map((entry) => ({ ...entry, instanceId: idMap.get(entry.instanceId) ?? entry.instanceId })),
    detached: (layout.detached ?? []).map((entry) => ({ ...entry, instanceId: idMap.get(entry.instanceId) ?? entry.instanceId })),
  };
  return { layout: removePaneInstances(mapped, removed), idMap, removed };
}

function foldPaneState(
  value: unknown,
  idMap: Map<string, string>,
  removed: Set<string>,
): unknown {
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([instanceId]) => !removed.has(instanceId))
      .map(([instanceId, entry]) => [idMap.get(instanceId) ?? instanceId, entry]),
  );
}

function foldFocus(value: unknown, idMap: Map<string, string>, removed: Set<string>): unknown {
  if (typeof value !== "string") return value;
  if (removed.has(value)) return null;
  return idMap.get(value) ?? value;
}

function foldLayoutField(value: unknown): FoldedLayout | null {
  const layout = asLayout(value);
  if (!layout) return null;
  return foldPaneLayout(layout);
}

/** Rewrite the open layout and every saved tab. */
export function foldSavedPanes(saved: Record<string, unknown>): Record<string, unknown> {
  const open = foldLayoutField(saved.layout);
  const layouts = Array.isArray(saved.layouts)
    ? saved.layouts.map((entry) => {
      if (!isRecord(entry)) return entry;
      const folded = foldLayoutField(entry.layout);
      if (!folded) return entry;
      return {
        ...entry,
        layout: folded.layout,
        paneState: foldPaneState(entry.paneState, folded.idMap, folded.removed),
        focusedPaneId: foldFocus(entry.focusedPaneId, folded.idMap, folded.removed),
      };
    })
    : saved.layouts;
  return {
    ...saved,
    ...(open ? { layout: open.layout } : {}),
    layouts,
  };
}

/** Move related market and energy panes into the one Commodities & Energy workspace. */
export function foldCommoditiesPaneLayout(layout: LayoutConfig): LayoutConfig {
  const instances = layout.instances.map((instance) => {
    const tab = COMMODITIES_ENERGY_TABS[instance.paneId];
    if (!tab) return instance;
    return {
      ...instance,
      paneId: COMMODITIES_ENERGY_PANE_ID,
      params: { ...(instance.params ?? {}), tab },
    };
  });
  return { ...layout, instances };
}

function foldCommoditiesPaneState(value: unknown, layout: LayoutConfig): unknown {
  if (!isRecord(value)) return value;
  let next = value;
  for (const instance of layout.instances) {
    const stateId = COMMODITIES_MODULE_STATE[instance.paneId];
    if (!stateId) continue;
    const entry = next[instance.instanceId];
    if (!isRecord(entry) || !isRecord(entry.pluginState)) continue;
    const oldState = entry.pluginState["market-overview"];
    if (!isRecord(oldState)) continue;
    const pluginState = { ...entry.pluginState };
    pluginState[stateId] = {
      ...oldState,
      ...(isRecord(pluginState[stateId]) ? pluginState[stateId] : {}),
    };
    delete pluginState["market-overview"];
    next = { ...next, [instance.instanceId]: { ...entry, pluginState } };
  }
  return next;
}

function foldCommoditiesLayoutField(value: unknown): LayoutConfig | null {
  const layout = asLayout(value);
  return layout ? foldCommoditiesPaneLayout(layout) : null;
}

/** Rewrite old panes in the open layout and every saved layout, retaining the selected tab and module state. */
export function foldSavedCommoditiesPanes(saved: Record<string, unknown>): Record<string, unknown> {
  const open = foldCommoditiesLayoutField(saved.layout);
  const layouts = Array.isArray(saved.layouts)
    ? saved.layouts.map((entry) => {
      if (!isRecord(entry)) return entry;
      const original = asLayout(entry.layout);
      if (!original) return entry;
      return {
        ...entry,
        layout: foldCommoditiesPaneLayout(original),
        paneState: foldCommoditiesPaneState(entry.paneState, original),
      };
    })
    : saved.layouts;
  return {
    ...saved,
    ...(open ? { layout: open } : {}),
    layouts,
  };
}
