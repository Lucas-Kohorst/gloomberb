import { useCallback } from "react";
import type { PaneHint } from "../../../components";
import { usePluginAppActions } from "../../runtime";

/** Command-bar / pane-template id for the floating Custom Chart composer. */
export const CHART_COMPOSER_TEMPLATE_ID = "chart-composer-pane";

export function openChartComposerPopOut(
  createPaneFromTemplate: (templateId: string, options?: { arg?: string }) => void,
  expression: string | null | undefined,
): boolean {
  const arg = expression?.trim();
  if (!arg) return false;
  createPaneFromTemplate(CHART_COMPOSER_TEMPLATE_ID, { arg });
  return true;
}

export function graphFooterHint(onGraph: () => void, enabled = true): PaneHint {
  return {
    id: "graph",
    key: "g",
    label: "raph",
    onPress: onGraph,
    disabled: !enabled,
  };
}

export function useGraphChartPopOut() {
  const { createPaneFromTemplate } = usePluginAppActions();
  return useCallback((expression: string | null | undefined) => {
    openChartComposerPopOut(createPaneFromTemplate, expression);
  }, [createPaneFromTemplate]);
}
