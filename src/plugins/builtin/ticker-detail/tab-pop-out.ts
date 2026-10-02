import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
import type { PaneTemplateDef, PaneTemplateInstanceConfig } from "../../../types/plugin";

export const TICKER_RESEARCH_TAB_POP_OUT_TEMPLATE_ID = "ticker-research-tab-pane";

function instanceIdPart(value: string): string {
  return encodeURIComponent(value.trim().toUpperCase()).replace(/%/g, "~");
}

export function buildTickerResearchTabPopOutInstance(
  symbol: string | null | undefined,
  tabId: string | null | undefined,
  tabName?: string | null,
): PaneTemplateInstanceConfig | null {
  const normalizedSymbol = symbol?.trim().toUpperCase();
  const normalizedTabId = tabId?.trim();
  if (!normalizedSymbol || !normalizedTabId) return null;
  return {
    // Distinct from tab-shortcut instances (HDS, etc.) so popping out never
    // hijacks a tabbed pane that happens to be on the same tab.
    instanceId: [
      TICKER_RESEARCH_PANE_ID,
      "tab",
      instanceIdPart(normalizedSymbol),
      instanceIdPart(normalizedTabId),
    ].join(":"),
    title: `${tabName?.trim() || normalizedTabId} ${normalizedSymbol}`,
    binding: { kind: "fixed", symbol: normalizedSymbol },
    placement: "floating",
    settings: { hideTabs: true, lockedTabId: normalizedTabId },
  };
}

export const tickerResearchTabPopOutTemplate: PaneTemplateDef = {
  id: TICKER_RESEARCH_TAB_POP_OUT_TEMPLATE_ID,
  paneId: TICKER_RESEARCH_PANE_ID,
  label: "Research Tab",
  description: "Pop one ticker research tab out into its own pane.",
  keywords: ["research", "tab", "pop", "out", "detach"],
  canCreate: (_context, options) => !!options?.symbol?.trim() && !!options?.values?.tabId?.trim(),
  createInstance: (_context, options) => buildTickerResearchTabPopOutInstance(
    options?.symbol,
    options?.values?.tabId,
    options?.values?.tabName,
  ),
};
