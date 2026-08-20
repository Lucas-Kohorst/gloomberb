import { updatePaneInstance } from "../pane-settings";
import {
  CHART_COMPOSER_PANE_ID,
  findPaneInstance,
  isTickerPaneId,
  normalizePaneId,
  TICKER_RESEARCH_PANE_ID,
  TRADINGVIEW_PANE_ID,
  type LayoutConfig,
  type PaneInstanceConfig,
} from "../types/config";
import type { PaneSettingField, PaneSettingsDef } from "../types/plugin";

export const TICKER_FOLLOW_SOURCE_KEY = "followSource";
export const TICKER_FOLLOW_PINNED_VALUE = "fixed";

export function isTickerLinkedPane(instance: PaneInstanceConfig): boolean {
  const paneId = normalizePaneId(instance.paneId);
  return isTickerPaneId(paneId)
    || paneId === CHART_COMPOSER_PANE_ID
    || paneId === TRADINGVIEW_PANE_ID;
}

export function canRetargetPaneTicker(instance: PaneInstanceConfig): boolean {
  return isTickerLinkedPane(instance);
}

export type TickerWriteTarget =
  | { kind: "cursor"; instanceId: string }
  | { kind: "fixed"; instanceId: string };

export function resolveTickerWriteTarget(
  layout: LayoutConfig,
  paneId: string,
  seen = new Set<string>(),
): TickerWriteTarget | null {
  if (seen.has(paneId)) return null;
  seen.add(paneId);
  const instance = findPaneInstance(layout, paneId);
  if (!instance) return null;
  if (instance.paneId === "portfolio-list") {
    return { kind: "cursor", instanceId: instance.instanceId };
  }
  if (instance.binding?.kind === "follow") {
    return resolveTickerWriteTarget(layout, instance.binding.sourceInstanceId, seen)
      ?? { kind: "fixed", instanceId: instance.instanceId };
  }
  return { kind: "fixed", instanceId: instance.instanceId };
}

export function retargetTickerPaneTitle(instance: PaneInstanceConfig, symbol: string): string | undefined {
  if (instance.paneId === TICKER_RESEARCH_PANE_ID) return symbol;
  const previous = instance.binding?.kind === "fixed" ? instance.binding.symbol : null;
  if (previous && instance.title) {
    if (instance.title === previous) return symbol;
    if (instance.title.endsWith(` ${previous}`)) {
      return `${instance.title.slice(0, -previous.length)}${symbol}`;
    }
  }
  return instance.title ?? symbol;
}

export function applyTickerRetarget(
  layout: LayoutConfig,
  paneId: string,
  symbol: string,
): { layout: LayoutConfig; cursor: { paneId: string; symbol: string } | null } {
  const target = resolveTickerWriteTarget(layout, paneId);
  if (!target) {
    return { layout, cursor: null };
  }
  if (target.kind === "cursor") {
    return { layout, cursor: { paneId: target.instanceId, symbol } };
  }

  return {
    layout: updatePaneInstance(layout, target.instanceId, (instance) => ({
      ...instance,
      title: retargetTickerPaneTitle(instance, symbol),
      binding: { kind: "fixed", symbol },
    })),
    cursor: null,
  };
}

export function wouldCreateFollowCycle(
  layout: LayoutConfig,
  paneId: string,
  sourceInstanceId: string,
): boolean {
  if (paneId === sourceInstanceId) return true;
  const seen = new Set<string>([paneId]);
  let current: string | null = sourceInstanceId;
  while (current) {
    if (seen.has(current)) return true;
    seen.add(current);
    const instance = findPaneInstance(layout, current);
    if (!instance || instance.binding?.kind !== "follow") return false;
    current = instance.binding.sourceInstanceId;
  }
  return false;
}

export function setPaneFollowSource(
  layout: LayoutConfig,
  paneId: string,
  sourceValue: string,
  currentSymbol: string | null,
): LayoutConfig {
  const instance = findPaneInstance(layout, paneId);
  if (!instance || !canRetargetPaneTicker(instance)) return layout;

  if (sourceValue === TICKER_FOLLOW_PINNED_VALUE || sourceValue === "") {
    if (!currentSymbol) return layout;
    return updatePaneInstance(layout, paneId, (pane) => ({
      ...pane,
      title: retargetTickerPaneTitle(pane, currentSymbol),
      binding: { kind: "fixed", symbol: currentSymbol },
    }));
  }

  if (!findPaneInstance(layout, sourceValue) || wouldCreateFollowCycle(layout, paneId, sourceValue)) {
    return layout;
  }

  return updatePaneInstance(layout, paneId, (pane) => ({
    ...pane,
    binding: { kind: "follow", sourceInstanceId: sourceValue },
  }));
}

export function currentFollowSourceValue(instance: PaneInstanceConfig): string {
  return instance.binding?.kind === "follow" ? instance.binding.sourceInstanceId : TICKER_FOLLOW_PINNED_VALUE;
}

export function listFollowSourceOptions(
  layout: LayoutConfig,
  paneId: string,
  titleFor: (instance: PaneInstanceConfig) => string,
): Array<{ value: string; label: string; description?: string }> {
  const instance = findPaneInstance(layout, paneId);
  if (!instance) return [];

  const options: Array<{ value: string; label: string; description?: string }> = [
    {
      value: TICKER_FOLLOW_PINNED_VALUE,
      label: "Pin ticker",
      description: "Keep this pane on its own symbol",
    },
  ];

  for (const candidate of layout.instances) {
    if (candidate.instanceId === paneId) continue;
    const isSource = candidate.paneId === "portfolio-list" || isTickerLinkedPane(candidate);
    if (!isSource) continue;
    if (wouldCreateFollowCycle(layout, paneId, candidate.instanceId)) continue;
    options.push({
      value: candidate.instanceId,
      label: titleFor(candidate),
      description: candidate.paneId === "portfolio-list"
        ? "Follow the selected row in this collection"
        : "Follow this pane's ticker",
    });
  }

  return options;
}

export function withTickerFollowSetting(
  settingsDef: PaneSettingsDef,
  instance: PaneInstanceConfig,
  layout: LayoutConfig,
  titleFor: (pane: PaneInstanceConfig) => string,
): PaneSettingsDef {
  if (!canRetargetPaneTicker(instance)) return settingsDef;

  const field: PaneSettingField = {
    type: "select",
    key: TICKER_FOLLOW_SOURCE_KEY,
    label: "Follow",
    description: "Linked panes share a ticker through follow bindings. Pin to keep this pane independent.",
    options: listFollowSourceOptions(layout, instance.instanceId, titleFor),
  };

  return {
    ...settingsDef,
    values: {
      ...settingsDef.values,
      [TICKER_FOLLOW_SOURCE_KEY]: currentFollowSourceValue(instance),
    },
    fields: [
      ...settingsDef.fields.filter((entry) => entry.key !== TICKER_FOLLOW_SOURCE_KEY),
      field,
    ],
  };
}
