import { useCallback, useMemo, useRef } from "react";
import type { PaneFooterSegment } from "../../../components";
import { scheduleConfigSave } from "../../../state/config-save-scheduler";
import { useAppDispatch, useAppSelector, useAppStateRef } from "../../../state/app/context";
import type { PaneSettingField } from "../../../types/plugin";
import { usePluginConfigState } from "../../runtime";

export const FEED_POLL_INTERVAL_MINUTES = [1, 5, 15, 30] as const;

export function coercePollIntervalMinutes(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
    return Math.floor(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed >= 1) return parsed;
  }
  return null;
}
export const DEFAULT_TWITTER_POLL_INTERVAL_MINUTES = 1;
export const TWITTER_POLL_INTERVAL_CONFIG_KEY = "pollIntervalMinutes";
/** gloomberb-cloud pluginConfig. Off unless the stored value is exactly true. */
export const X_LIVE_POLLING_CONFIG_KEY = "xLivePollingEnabled";

export function isXLivePollingEnabled(value: unknown): boolean {
  return value === true;
}

/** useAutoRefresh treats 0 as no interval timer. */
export function twitterLivePollIntervalMinutes(
  livePollingEnabled: boolean,
  intervalMinutes: number,
): number {
  return livePollingEnabled ? intervalMinutes : 0;
}

export function formatPollIntervalFooterLabel(minutes: number): string {
  return `poll ${Math.max(1, Math.floor(minutes))}m`;
}

export function nextPollIntervalMinutes(current: number): number {
  const normalized = Math.max(1, Math.floor(current));
  const index = FEED_POLL_INTERVAL_MINUTES.indexOf(
    normalized as (typeof FEED_POLL_INTERVAL_MINUTES)[number],
  );
  if (index < 0) {
    return FEED_POLL_INTERVAL_MINUTES.find((option) => option > normalized) ?? FEED_POLL_INTERVAL_MINUTES[0];
  }
  return FEED_POLL_INTERVAL_MINUTES[(index + 1) % FEED_POLL_INTERVAL_MINUTES.length]!;
}

export function resolveFeedPollIntervalMinutes(
  globalMinutes: number,
  overrideMinutes?: unknown,
  defaultMinutes?: number,
): number {
  const override = coercePollIntervalMinutes(overrideMinutes);
  if (override != null) return override;
  if (typeof defaultMinutes === "number" && defaultMinutes >= 1) {
    return Math.floor(defaultMinutes);
  }
  return Math.max(1, Math.floor(globalMinutes || 1));
}

export function buildPollIntervalSettingField(key: string): PaneSettingField {
  return {
    key,
    label: "Refresh interval",
    description: "How often this pane reloads while it is open.",
    type: "select",
    storage: "plugin",
    options: FEED_POLL_INTERVAL_MINUTES.map((minutes) => ({
      value: String(minutes),
      label: minutes === 1 ? "1 minute" : `${minutes} minutes`,
    })),
  };
}

function pollSegment(minutes: number, cycle: () => void): PaneFooterSegment {
  return {
    id: "poll-interval",
    parts: [{ text: formatPollIntervalFooterLabel(minutes), tone: "muted" }],
    onPress: cycle,
  };
}

export function useFeedPollInterval(options?: {
  overrideConfigKey?: string;
  defaultMinutes?: number;
}): {
  intervalMinutes: number;
  intervalMs: number;
  label: string;
  cycle: () => void;
  segment: PaneFooterSegment;
} {
  const dispatch = useAppDispatch();
  const stateRef = useAppStateRef();
  const globalMinutes = useAppSelector((state) => state.config.refreshIntervalMinutes);
  const [overrideMinutes, setOverrideMinutes] = usePluginConfigState<number | null>(
    options?.overrideConfigKey ?? "__unusedFeedPollOverride",
    null,
  );
  const usingOverride = !!options?.overrideConfigKey;
  const intervalMinutes = resolveFeedPollIntervalMinutes(
    globalMinutes,
    usingOverride ? overrideMinutes : null,
    usingOverride ? options?.defaultMinutes : undefined,
  );
  const cycleRef = useRef<() => void>(() => {});

  const cycle = useCallback(() => {
    const next = nextPollIntervalMinutes(intervalMinutes);
    if (usingOverride) {
      setOverrideMinutes(next);
      return;
    }
    const currentState = stateRef.current;
    const nextConfig = {
      ...currentState.config,
      refreshIntervalMinutes: next,
    };
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    scheduleConfigSave(nextConfig);
  }, [dispatch, intervalMinutes, setOverrideMinutes, stateRef, usingOverride]);
  cycleRef.current = cycle;

  const stableCycle = useCallback(() => {
    cycleRef.current();
  }, []);

  return useMemo(() => ({
    intervalMinutes,
    intervalMs: intervalMinutes * 60_000,
    label: formatPollIntervalFooterLabel(intervalMinutes),
    cycle: stableCycle,
    segment: pollSegment(intervalMinutes, stableCycle),
  }), [intervalMinutes, stableCycle]);
}
