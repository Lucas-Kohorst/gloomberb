import { useEffect, useRef, useState } from "react";
import type { TickerResearchTabDef, TickerResearchTabLoadContext } from "../../../types/plugin";

type ResearchTabLoadStatus = "pending" | "ready" | "absent";

export interface ResearchTabLoadSnapshot {
  key: string;
  status: Readonly<Record<string, ResearchTabLoadStatus>>;
}

export function researchLoadsSettled<T extends { id: string; load?: unknown }>(
  tabs: readonly T[],
  snapshot: ResearchTabLoadSnapshot,
  tickerKey: string,
): boolean {
  const probed = tabs.filter((tab) => tab.load);
  if (probed.length === 0) return true;
  if (!tickerKey || snapshot.key !== tickerKey) return false;
  return probed.every((tab) => {
    const state = snapshot.status[tab.id];
    return state === "ready" || state === "absent";
  });
}

export function offerResearchTabs<T extends { id: string; load?: unknown }>(
  tabs: readonly T[],
  snapshot: ResearchTabLoadSnapshot,
  tickerKey: string,
  preferredId: string,
): T[] {
  const settled = researchLoadsSettled(tabs, snapshot, tickerKey);
  return tabs.filter((tab) => {
    if (!tab.load) return true;
    if (!settled) return tab.id === preferredId;
    return snapshot.status[tab.id] === "ready";
  });
}

export function useResearchTabLoads(
  tabs: readonly TickerResearchTabDef[],
  tickerKey: string,
  context: Omit<TickerResearchTabLoadContext, "signal"> | null,
): ResearchTabLoadSnapshot {
  const [snapshot, setSnapshot] = useState<ResearchTabLoadSnapshot>({ key: "", status: {} });
  const contextRef = useRef(context);
  const tabsRef = useRef(tabs);
  contextRef.current = context;
  tabsRef.current = tabs;
  const loadKey = tabs.filter((tab) => tab.load).map((tab) => tab.id).join("\0");

  useEffect(() => {
    const current = contextRef.current;
    if (!tickerKey || !current) {
      setSnapshot({ key: "", status: {} });
      return;
    }
    const loading = tabsRef.current.filter((tab) => tab.load);
    if (loading.length === 0) return;
    const controller = new AbortController();
    const key = tickerKey;
    const loadContext: TickerResearchTabLoadContext = { ...current, signal: controller.signal };
    const status: Record<string, ResearchTabLoadStatus> = {};
    let remaining = loading.length;
    const finish = (id: string, next: ResearchTabLoadStatus) => {
      if (controller.signal.aborted || status[id]) return;
      status[id] = next;
      remaining -= 1;
      if (remaining === 0) setSnapshot({ key, status: { ...status } });
    };
    for (const tab of loading) {
      void Promise.resolve()
        .then(() => tab.load!(loadContext))
        .then((available) => finish(tab.id, available ? "ready" : "absent"))
        .catch(() => finish(tab.id, "ready"));
    }
    return () => controller.abort();
  }, [loadKey, tickerKey]);

  return snapshot;
}
