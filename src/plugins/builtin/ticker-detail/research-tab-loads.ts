import { useEffect, useRef } from "react";
import type { TickerResearchTabDef, TickerResearchTabLoadContext } from "../../../types/plugin";

/**
 * Warm every tab's cache when the ticker is selected. The strip already lists
 * those tabs, so a prefetch never adds or removes one.
 */
export function useResearchTabLoads(
  tabs: readonly TickerResearchTabDef[],
  tickerKey: string,
  context: TickerResearchTabLoadContext | null,
): void {
  const contextRef = useRef(context);
  const tabsRef = useRef(tabs);
  contextRef.current = context;
  tabsRef.current = tabs;
  const loadKey = tabs.filter((tab) => tab.load).map((tab) => tab.id).join("\0");

  useEffect(() => {
    const current = contextRef.current;
    if (!tickerKey || !current) return;
    const controller = new AbortController();
    const loading = tabsRef.current.filter((tab) => tab.load);
    if (loading.length === 0) return;
    const loadContext: TickerResearchTabLoadContext = { ...current, signal: controller.signal };
    for (const tab of loading) {
      void Promise.resolve()
        .then(() => tab.load!(loadContext))
        .catch(() => undefined);
    }
    return () => controller.abort();
  }, [loadKey, tickerKey]);
}
