import {
  getDockedPaneIds,
} from "../plugins/pane-manager";
import { createBlankLayout, createPaneInstance } from "../types/config";
import type { DockLayoutNode, LayoutConfig, PaneInstanceConfig } from "../types/config";
import type { PaneTemplateDef } from "../types/plugin";

export function requirePaneInstance(layout: LayoutConfig, paneId: string): PaneInstanceConfig {
  const instance = layout.instances.find((entry) => entry.instanceId === paneId)
    ?? layout.instances.find((entry) => entry.paneId === paneId);
  if (!instance) throw new Error(`Unknown pane "${paneId}".`);
  return instance;
}

export function buildGridDockRoot(paneIds: string[], columns?: number): DockLayoutNode | null {
  if (paneIds.length === 0) return null;
  const columnCount = Math.max(1, Math.min(
    paneIds.length,
    Number.isInteger(columns) && columns! > 0 ? columns! : Math.ceil(Math.sqrt(paneIds.length)),
  ));
  const rows: DockLayoutNode[] = [];
  for (let index = 0; index < paneIds.length; index += columnCount) {
    rows.push(buildSplit(
      paneIds.slice(index, index + columnCount).map((instanceId) => ({ kind: "pane", instanceId })),
      "horizontal",
    ));
  }
  return buildSplit(rows, "vertical");
}

export function buildSeededLayout(
  ids: string[],
  panes: ReadonlyMap<string, unknown>,
  paneTemplates: ReadonlyMap<string, PaneTemplateDef>,
): LayoutConfig {
  const resolvedPaneIds: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = String(raw);
    let paneId = id;
    if (!panes.has(id)) {
      const template = paneTemplates.get(id);
      if (template) {
        paneId = template.paneId;
      } else {
        throw new Error(`Unknown pane or template "${id}".`);
      }
    }
    if (!panes.has(paneId)) {
      throw new Error(`Unknown pane "${paneId}".`);
    }
    if (!seen.has(paneId)) {
      seen.add(paneId);
      resolvedPaneIds.push(paneId);
    }
  }
  const instances = resolvedPaneIds.map((paneId) => createPaneInstance(paneId));
  const instanceIds = instances.map((instance) => instance.instanceId);
  return {
    ...createBlankLayout(),
    instances,
    dockRoot: buildGridDockRoot(instanceIds),
  };
}

export function visiblePaneIds(layout: LayoutConfig): string[] {
  const ids = new Set<string>();
  getDockedPaneIds(layout).forEach((id) => ids.add(id));
  layout.floating.forEach((entry) => ids.add(entry.instanceId));
  (layout.detached ?? []).forEach((entry) => ids.add(entry.instanceId));
  return [...ids];
}

export function regionToDockPosition(region: string): "left" | "right" | "above" | "below" {
  if (region === "left" || region === "right") return region;
  if (region === "top") return "above";
  if (region === "bottom") return "below";
  throw new Error(`Unsupported dock region "${region}".`);
}

export function regionToRootEdge(region: string): "left" | "right" | "top" | "bottom" {
  if (region === "left" || region === "right" || region === "top" || region === "bottom") return region;
  throw new Error(`Unsupported root-edge region "${region}".`);
}

function buildSplit(nodes: DockLayoutNode[], axis: "horizontal" | "vertical"): DockLayoutNode {
  if (nodes.length === 0) throw new Error("Cannot build an empty dock split.");
  if (nodes.length === 1) return nodes[0]!;
  const splitIndex = Math.ceil(nodes.length / 2);
  const firstNodes = nodes.slice(0, splitIndex);
  const secondNodes = nodes.slice(splitIndex);
  return {
    kind: "split",
    axis,
    ratio: firstNodes.length / nodes.length,
    first: buildSplit(firstNodes, axis),
    second: buildSplit(secondNodes, axis),
  };
}
