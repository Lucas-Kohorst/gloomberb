import { canRetargetPaneTicker } from "../../plugins/ticker-follow";
import type { PaneInstanceConfig } from "../../types/config";

export const HEADER_TICKER_PLACEHOLDER = "<ticker>";

export function buildHeaderTickerSearchLaunch(
  rawQuery: string,
  focusedPane: PaneInstanceConfig | null | undefined,
): {
  kind: "ticker-search";
  query: string;
  replacePaneId?: string;
} {
  const query = rawQuery.trim();
  const replacePaneId = focusedPane && canRetargetPaneTicker(focusedPane)
    ? focusedPane.instanceId
    : undefined;
  return replacePaneId
    ? { kind: "ticker-search", query, replacePaneId }
    : { kind: "ticker-search", query };
}
