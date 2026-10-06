import { resolveTickerForPane } from "../core/state/app/layout";
import type { AppState } from "../core/state/app/types";
import { isPaneInLayout } from "./pane-manager";
import {
  findPaneInstance,
  TICKER_RESEARCH_PANE_ID,
  type PaneInstanceConfig,
} from "../types/config";

/** Same single-cell mark a linked pane title uses. */
export const LINKED_TICKER_MARK = "\u29c9";

export interface SelectedLayoutTicker {
  rootInstanceId: string;
  symbol: string;
  /** Visible panes that show this symbol, including the root. */
  memberCount: number;
}

/**
 * The ticker a layout is on. The focused pane's group wins. Otherwise the
 * largest group of two or more visible panes. A lone pane counts only while
 * it is focused, so a news pane does not hide a linked desk, and an unlinked
 * desk does not invent a group.
 */
export function selectedLayoutTicker(state: AppState): SelectedLayoutTicker | null {
  const groups = new Map<string, { symbol: string; count: number; order: number }>();
  state.config.layout.instances.forEach((instance, order) => {
    const rootId = tickerRootId(state, instance.instanceId);
    if (!rootId) return;
    const symbol = resolveTickerForPane(state, rootId);
    if (!symbol) return;
    const group = groups.get(rootId);
    if (group) group.count += 1;
    else groups.set(rootId, { symbol, count: 1, order });
  });

  const focusedRoot = state.focusedPaneId ? tickerRootId(state, state.focusedPaneId) : null;
  const focused = focusedRoot ? groups.get(focusedRoot) : undefined;
  if (focusedRoot && focused) {
    return { rootInstanceId: focusedRoot, symbol: focused.symbol, memberCount: focused.count };
  }

  let best: SelectedLayoutTicker & { order: number } | null = null;
  for (const [rootInstanceId, group] of groups) {
    if (group.count < 2) continue;
    if (
      !best
      || group.count > best.memberCount
      || (group.count === best.memberCount && group.order < best.order)
    ) {
      best = { rootInstanceId, symbol: group.symbol, memberCount: group.count, order: group.order };
    }
  }
  return best
    ? { rootInstanceId: best.rootInstanceId, symbol: best.symbol, memberCount: best.memberCount }
    : null;
}

export type LayoutTickerTarget =
  | { kind: "open" }
  | {
    kind: "retarget";
    rootInstanceId: string;
    mode: "research" | "cursor" | "fixed";
    /** The focused pane already shows this root, so the cursor stays put. */
    keepFocus: boolean;
  };

/**
 * Where a symbol chosen from the command bar is written. A linked group
 * rewrites its root. A focused research pane with no followers does too.
 * Anything else still opens a pane.
 */
export function layoutTickerTarget(
  state: AppState,
  options: { forceNewPane?: boolean; isTickerSource: (paneType: string) => boolean },
): LayoutTickerTarget {
  if (options.forceNewPane) return { kind: "open" };
  const selection = selectedLayoutTicker(state);
  if (!selection) return { kind: "open" };
  const root = findPaneInstance(state.config.layout, selection.rootInstanceId);
  if (!root) return { kind: "open" };
  const focusedRoot = state.focusedPaneId ? tickerRootId(state, state.focusedPaneId) : null;
  const keepFocus = focusedRoot === selection.rootInstanceId;
  const research = root.paneId === TICKER_RESEARCH_PANE_ID;
  if (selection.memberCount < 2 && !(keepFocus && research)) return { kind: "open" };
  return {
    kind: "retarget",
    rootInstanceId: root.instanceId,
    mode: options.isTickerSource(root.paneId) ? "cursor" : research ? "research" : "fixed",
    keepFocus,
  };
}

/** The pane whose symbol the others follow. A cycle or a hidden pane has none. */
function tickerRootId(state: AppState, paneId: string, seen = new Set<string>()): string | null {
  if (seen.has(paneId)) return null;
  seen.add(paneId);
  const layout = state.config.layout;
  if (!isPaneInLayout(layout, paneId)) return null;
  const instance: PaneInstanceConfig | undefined = findPaneInstance(layout, paneId);
  if (!instance) return null;
  if (instance.binding?.kind === "follow") return tickerRootId(state, instance.binding.sourceInstanceId, seen);
  return resolveTickerForPane(state, paneId) ? paneId : null;
}
