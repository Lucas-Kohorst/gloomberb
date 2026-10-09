export const ALERTS_KEY = "alerts";
/** Fallback cadence when the pane's Check interval setting is unset. */
export const POLL_INTERVAL_MS = 30_000;
/** Same window as a breaking-news toast. The log row stays after the toast goes. */
export const ALERT_TOAST_DURATION_MS = 20_000;
/** Snooze window offered on a trigger toast. The poll skips evaluation until it passes. */
export const SNOOZE_DURATION_MS = 15 * 60_000;
/** The same window in whole minutes, for the toast action. */
export const SNOOZE_MINUTES = SNOOZE_DURATION_MS / 60_000;
export const POLL_SECONDS_KEY = "pollSeconds";
