import type { FloatingPaneEntry, LayoutConfig } from "../../types/config";
import {
  boundsForRects,
  inferCompactedDockTree,
  inferDockTreeFromRects,
  type GridlockRect,
} from "./gridlock-inference";
import {
  findDockLeaf,
  getDockedPaneIds,
  getDockLeafLayouts,
  type LayoutBounds,
} from "./dock-tree";
import {
  finalizeLayout,
  removeUnavailablePaneTypes,
  type PaneTypeAvailability,
} from "./layout-state";
import { floatAtRect } from "./floating-actions";

export const LAYOUT_PRESET_IDS = ["single", "2x2", "3x3", "left-main"] as const;
export type LayoutPresetId = typeof LAYOUT_PRESET_IDS[number];

function splitDimension(total: number, parts: number, index: number): { start: number; size: number } {
  const start = Math.floor((total * index) / parts);
  const end = Math.floor((total * (index + 1)) / parts);
  return { start, size: Math.max(1, end - start) };
}

function visiblePaneIds(layout: LayoutConfig): string[] {
  return [
    ...getDockedPaneIds(layout),
    ...layout.floating.map((entry) => entry.instanceId),
  ];
}

function makeGridPresetRects(
  instanceIds: string[],
  bounds: LayoutBounds,
  columns: number,
): GridlockRect[] {
  const columnCount = Math.max(1, Math.min(columns, instanceIds.length));
  const rowCount = Math.max(1, Math.ceil(instanceIds.length / columnCount));
  return instanceIds.map((instanceId, index) => {
    const column = index % columnCount;
    const row = Math.floor(index / columnCount);
    const horizontal = splitDimension(bounds.width, columnCount, column);
    const vertical = splitDimension(bounds.height, rowCount, row);
    return {
      instanceId,
      x: bounds.x + horizontal.start,
      y: bounds.y + vertical.start,
      width: horizontal.size,
      height: vertical.size,
    };
  });
}

function makeLeftMainPresetRects(instanceIds: string[], bounds: LayoutBounds): GridlockRect[] {
  if (instanceIds.length <= 1) {
    return instanceIds.map((instanceId) => ({ instanceId, ...bounds }));
  }

  const left = splitDimension(bounds.width, 2, 0);
  const right = splitDimension(bounds.width, 2, 1);
  const stackedIds = instanceIds.slice(1);
  return [
    {
      instanceId: instanceIds[0]!,
      x: bounds.x + left.start,
      y: bounds.y,
      width: left.size,
      height: bounds.height,
    },
    ...stackedIds.map((instanceId, index) => {
      const vertical = splitDimension(bounds.height, stackedIds.length, index);
      return {
        instanceId,
        x: bounds.x + right.start,
        y: bounds.y + vertical.start,
        width: right.size,
        height: vertical.size,
      };
    }),
  ];
}

export function applyLayoutPreset(
  layout: LayoutConfig,
  preset: LayoutPresetId,
  bounds: LayoutBounds = { x: 0, y: 0, width: 120, height: 40 },
  paneTypes?: PaneTypeAvailability,
): LayoutConfig {
  const visibleLayout = paneTypes
    ? removeUnavailablePaneTypes(layout, paneTypes)
    : layout;
  const instanceIds = visiblePaneIds(visibleLayout);
  if (instanceIds.length === 0) return visibleLayout;

  const rects = preset === "left-main"
    ? makeLeftMainPresetRects(instanceIds, bounds)
    : makeGridPresetRects(instanceIds, bounds, preset === "single" ? 1 : preset === "2x2" ? 2 : 3);

  return finalizeLayout({
    ...visibleLayout,
    dockRoot: inferDockTreeFromRects(rects, bounds),
    floating: visibleLayout.floating.filter((entry) => !instanceIds.includes(entry.instanceId)),
  });
}

export function snapPaneToGridRect(
  layout: LayoutConfig,
  instanceId: string,
  targetRect: LayoutBounds,
  _bounds: LayoutBounds,
): LayoutConfig {
  const visibleIds = new Set(visiblePaneIds(layout));
  if (!visibleIds.has(instanceId)) return layout;
  return floatAtRect(layout, instanceId, { ...targetRect, fixedGeometry: true });
}

export function compactDockedPaneAtRect(
  layout: LayoutConfig,
  draggedInstanceId: string,
  targetRect: LayoutBounds,
  bounds: LayoutBounds,
): LayoutConfig {
  if (!findDockLeaf(layout, draggedInstanceId)) return layout;
  const dockRoot = inferCompactedDockTree(layout, draggedInstanceId, targetRect, bounds);
  if (!dockRoot) return layout;
  return finalizeLayout({
    ...layout,
    dockRoot,
    floating: layout.floating,
  });
}

const BURIED_VISIBLE_RATIO = 0.2;
const TITLE_BAR_HEIGHT_RATIO = 0.12;
const TIDY_FLOATING_THRESHOLD = 3;

type Rect = Pick<FloatingPaneEntry, "x" | "y" | "width" | "height">;

export interface FloatingPaneVisibility {
  instanceId: string;
  buried: boolean;
  visibleRatio: number;
  titleBarVisibleRatio: number;
}

function rectArea(rect: Rect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

function subtractRect(rect: Rect, cover: Rect): Rect[] {
  const left = Math.max(rect.x, cover.x);
  const top = Math.max(rect.y, cover.y);
  const right = Math.min(rect.x + rect.width, cover.x + cover.width);
  const bottom = Math.min(rect.y + rect.height, cover.y + cover.height);
  if (left >= right || top >= bottom) return [rect];

  return [
    { x: rect.x, y: rect.y, width: rect.width, height: top - rect.y },
    { x: rect.x, y: bottom, width: rect.width, height: rect.y + rect.height - bottom },
    { x: rect.x, y: top, width: left - rect.x, height: bottom - top },
    { x: right, y: top, width: rect.x + rect.width - right, height: bottom - top },
  ].filter((piece) => piece.width > 0 && piece.height > 0);
}

function visibleRatio(rect: Rect, covers: Rect[]): number {
  const area = rectArea(rect);
  if (area === 0) return 0;
  let pieces = [rect];
  for (const cover of covers) {
    pieces = pieces.flatMap((piece) => subtractRect(piece, cover));
    if (pieces.length === 0) return 0;
  }
  return Math.min(1, pieces.reduce((sum, piece) => sum + rectArea(piece), 0) / area);
}

export function analyzeFloatingPaneVisibility(layout: LayoutConfig): FloatingPaneVisibility[] {
  const frontToBack = layout.floating
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => (
      (right.entry.zIndex ?? 50) - (left.entry.zIndex ?? 50)
      || right.index - left.index
    ));
  const covers: Rect[] = [];

  return frontToBack.map(({ entry }) => {
    const paneVisibleRatio = visibleRatio(entry, covers);
    const titleBar = {
      x: entry.x,
      y: entry.y,
      width: entry.width,
      height: Math.min(entry.height, Math.max(1, entry.height * TITLE_BAR_HEIGHT_RATIO)),
    };
    const titleBarVisibleRatio = visibleRatio(titleBar, covers);
    covers.push(entry);
    return {
      instanceId: entry.instanceId,
      buried: paneVisibleRatio < BURIED_VISIBLE_RATIO || titleBarVisibleRatio < BURIED_VISIBLE_RATIO,
      visibleRatio: paneVisibleRatio,
      titleBarVisibleRatio,
    };
  });
}

export function shouldShowTidyWindows(layout: LayoutConfig): boolean {
  return layout.floating.length >= TIDY_FLOATING_THRESHOLD
    || analyzeFloatingPaneVisibility(layout).some((pane) => pane.buried);
}

const BURIED_VISIBLE_RATIO = 0.2;
const TITLE_BAR_HEIGHT_RATIO = 0.12;
const TIDY_FLOATING_THRESHOLD = 3;

type Rect = Pick<FloatingPaneEntry, "x" | "y" | "width" | "height">;

export interface FloatingPaneVisibility {
  instanceId: string;
  buried: boolean;
  visibleRatio: number;
  titleBarVisibleRatio: number;
}

function rectArea(rect: Rect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

function subtractRect(rect: Rect, cover: Rect): Rect[] {
  const left = Math.max(rect.x, cover.x);
  const top = Math.max(rect.y, cover.y);
  const right = Math.min(rect.x + rect.width, cover.x + cover.width);
  const bottom = Math.min(rect.y + rect.height, cover.y + cover.height);
  if (left >= right || top >= bottom) return [rect];

  return [
    { x: rect.x, y: rect.y, width: rect.width, height: top - rect.y },
    { x: rect.x, y: bottom, width: rect.width, height: rect.y + rect.height - bottom },
    { x: rect.x, y: top, width: left - rect.x, height: bottom - top },
    { x: right, y: top, width: rect.x + rect.width - right, height: bottom - top },
  ].filter((piece) => piece.width > 0 && piece.height > 0);
}

function visibleRatio(rect: Rect, covers: Rect[]): number {
  const area = rectArea(rect);
  if (area === 0) return 0;
  let pieces = [rect];
  for (const cover of covers) {
    pieces = pieces.flatMap((piece) => subtractRect(piece, cover));
    if (pieces.length === 0) return 0;
  }
  return Math.min(1, pieces.reduce((sum, piece) => sum + rectArea(piece), 0) / area);
}

export function analyzeFloatingPaneVisibility(layout: LayoutConfig): FloatingPaneVisibility[] {
  const frontToBack = layout.floating
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => (
      (right.entry.zIndex ?? 50) - (left.entry.zIndex ?? 50)
      || right.index - left.index
    ));
  const covers: Rect[] = [];

  return frontToBack.map(({ entry }) => {
    const paneVisibleRatio = visibleRatio(entry, covers);
    const titleBar = {
      x: entry.x,
      y: entry.y,
      width: entry.width,
      height: Math.min(entry.height, Math.max(1, entry.height * TITLE_BAR_HEIGHT_RATIO)),
    };
    const titleBarVisibleRatio = visibleRatio(titleBar, covers);
    covers.push(entry);
    return {
      instanceId: entry.instanceId,
      buried: paneVisibleRatio < BURIED_VISIBLE_RATIO || titleBarVisibleRatio < BURIED_VISIBLE_RATIO,
      visibleRatio: paneVisibleRatio,
      titleBarVisibleRatio,
    };
  });
}

export function shouldShowTidyWindows(layout: LayoutConfig): boolean {
  return layout.floating.length >= TIDY_FLOATING_THRESHOLD
    || analyzeFloatingPaneVisibility(layout).some((pane) => pane.buried);
}

function gridlockPanes(
  layout: LayoutConfig,
  bounds: LayoutBounds,
  paneTypes?: PaneTypeAvailability,
): LayoutConfig {
  const visibleLayout = paneTypes
    ? removeUnavailablePaneTypes(layout, paneTypes)
    : layout;
  const dockedRects: GridlockRect[] = getDockLeafLayouts(visibleLayout, bounds)
    .map((leaf) => ({ instanceId: leaf.instanceId, ...leaf.rect }));
  const floatingRects: GridlockRect[] = visibleLayout.floating.map((entry) => ({
    instanceId: entry.instanceId,
    x: entry.x,
    y: entry.y,
    width: entry.width,
    height: entry.height,
  }));
  const allRects = [...dockedRects, ...floatingRects];
  if (allRects.length === 0) return visibleLayout;

  return finalizeLayout({
    ...visibleLayout,
    dockRoot: inferDockTreeFromRects(allRects, boundsForRects(allRects)),
    floating: [],
  });
}

export function gridlockAllPanes(
  layout: LayoutConfig,
  bounds: LayoutBounds = { x: 0, y: 0, width: 120, height: 40 },
  paneTypes?: PaneTypeAvailability,
): LayoutConfig {
  return gridlockPanes(layout, bounds, paneTypes);
}
