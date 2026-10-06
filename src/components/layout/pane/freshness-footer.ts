import { useCallback, useEffect, useMemo, useState } from "react";
import { AGE_TICK_MS } from "../../../react/auto-refresh";
import { useAppDispatch, useAppSelector, useAppStateRef } from "../../../state/app/context";
import { usePaneVisible } from "../../../state/app/activity";
import { scheduleConfigSave } from "../../../state/config-save-scheduler";
import { formatApproximateAge } from "../../../utils/datetime-format";
import type { PaneFooterSegment } from "./footer";

/** Choices on the poll chip. The label is the value this menu writes. */
export const FEED_POLL_INTERVAL_MINUTES = [1, 5, 15, 30] as const;

export function formatPollIntervalFooterLabel(minutes: number): string {
  return `poll ${Math.max(1, Math.floor(minutes))}m`;
}

export function pollIntervalOptionLabel(minutes: number): string {
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

export function pollIntervalMenuOptions(): Array<{ value: string; label: string }> {
  return FEED_POLL_INTERVAL_MINUTES.map((minutes) => ({
    value: String(minutes),
    label: pollIntervalOptionLabel(minutes),
  }));
}

/** Left side of the footer: `updated ~0m`. Empty before the first successful load. */
export function updatedFooterInfo(
  updatedAt: number | null | undefined,
  now = Date.now(),
): PaneFooterSegment[] {
  if (updatedAt == null || !Number.isFinite(updatedAt)) return [];
  return [{
    id: "updated",
    parts: [{ text: `updated ${formatApproximateAge(updatedAt, now)}`, tone: "muted" }],
  }];
}

/** Right side of the footer, after the hints: `poll 30m`. `setMinutes` makes it the interval menu. */
export function pollFooterSegment(
  minutes: number,
  setMinutes?: (minutes: number) => void,
): PaneFooterSegment {
  const normalized = Math.max(1, Math.floor(minutes));
  return {
    id: "poll-interval",
    parts: [{ text: formatPollIntervalFooterLabel(normalized), tone: "muted" }],
    ...(setMinutes ? {
      menu: {
        value: String(normalized),
        options: pollIntervalMenuOptions(),
        onSelect: (value: string) => {
          const next = Number(value);
          if (Number.isFinite(next) && next >= 1) setMinutes(Math.floor(next));
        },
      },
    } : {}),
  };
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

/**
 * The refresh interval from settings, drawn on the right and editable from
 * the chip. `enabled` is false for a live stream or a reader that does not poll.
 */
export function useRefreshPollTrailing(enabled: boolean): PaneFooterSegment[] {
  const dispatch = useAppDispatch();
  const stateRef = useAppStateRef();
  const minutes = useAppSelector((state) => Math.max(0, Math.floor(state.config.refreshIntervalMinutes || 0)));
  const setMinutes = useCallback((next: number) => {
    const current = stateRef.current;
    if (current.config.refreshIntervalMinutes === next) return;
    const nextConfig = { ...current.config, refreshIntervalMinutes: next };
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    scheduleConfigSave(nextConfig);
  }, [dispatch, stateRef]);

  return useMemo(
    () => (enabled && minutes > 0 ? [pollFooterSegment(minutes, setMinutes)] : []),
    [enabled, minutes, setMinutes],
  );
}
