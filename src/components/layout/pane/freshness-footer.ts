import { useEffect, useMemo, useState } from "react";
import { AGE_TICK_MS } from "../../../react/auto-refresh";
import { usePaneVisible } from "../../../state/app/activity";
import { formatApproximateAge } from "../../../utils/datetime-format";
import type { PaneFooterSegment } from "./footer";

/** Left side of the footer: `~5m`, `~1hr`, or `YYYY-MM-DD`. Empty before the first successful load. */
function updatedFooterInfo(
  updatedAt: number | null | undefined,
  now = Date.now(),
): PaneFooterSegment[] {
  if (updatedAt == null || !Number.isFinite(updatedAt)) return [];
  return [{
    id: "updated",
    parts: [{ text: formatApproximateAge(updatedAt, now), tone: "muted" }],
  }];
}

/** Age label that keeps ticking while the pane is on screen. */
export function useUpdatedFooterInfo(updatedAt: number | null | undefined): PaneFooterSegment[] {
  const visible = usePaneVisible();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (updatedAt == null || !visible) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), AGE_TICK_MS);
    return () => clearInterval(timer);
  }, [updatedAt, visible]);

  return useMemo(() => updatedFooterInfo(updatedAt, now), [now, updatedAt]);
}
