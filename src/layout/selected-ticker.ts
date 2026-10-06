import { resolveCollectionForPane, resolveTickerForPane } from "../core/state/app/layout";
import type { AppState } from "../core/state/app/types";
import { getCollectionTickersFromConfig } from "../plugins/builtin/portfolio-list/pane/data";
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
 * A portfolio or watchlist can only select a row it holds. Writing anything
 * else is undone by the list, which puts the cursor back on the first row.
 * Scanners and other cursor sources accept the symbol they were given.
 */
export function cursorSourceHoldsSymbol(state: AppState, rootInstanceId: string, symbol: string): boolean {
  const root = findPaneInstance(state.config.layout, rootInstanceId);
  if (!root || root.paneId !== "portfolio-list") return true;
  const collectionId = resolveCollectionForPane(state, rootInstanceId);
  if (!collectionId) return true;
  return getCollectionTickersFromConfig(state.config, state.tickers, collectionId)
    .some((ticker) => ticker.metadata.ticker === symbol);
}

/**
 * Where a symbol chosen from the command bar is written. A linked group
 * rewrites its root. A focused research pane with no followers does too.
 * A list that does not hold the named symbol opens a pane instead.
 * Anything else still opens a pane.
 */
export function layoutTickerTarget(
  state: AppState,
  options: {
    forceNewPane?: boolean;
    isTickerSource: (paneType: string) => boolean;
    /** The symbol being chosen. Omit when only the target kind matters. */
    symbol?: string;
  },
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
  const mode = options.isTickerSource(root.paneId) ? "cursor" : research ? "research" : "fixed";
  if (
    mode === "cursor"
    && options.symbol !== undefined
    && !cursorSourceHoldsSymbol(state, root.instanceId, options.symbol)
  ) {
    return { kind: "open" };
  }
  return {
    kind: "retarget",
    rootInstanceId: root.instanceId,
    mode,
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
