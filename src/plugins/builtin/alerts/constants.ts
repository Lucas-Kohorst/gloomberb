export const ALERTS_KEY = "alerts";
export const ALERT_HISTORY_KEY = "history";
/** Fallback cadence when the pane's Check interval setting is unset. */
export const POLL_INTERVAL_MS = 30_000;
export const POLL_SECONDS_KEY = "pollSeconds";
/** Snooze window offered by alert notifications and the alerts pane. */
export const SNOOZE_DURATION_MS = 15 * 60_000;
/** The same window in whole minutes, for display strings. */
export const SNOOZE_MINUTES = SNOOZE_DURATION_MS / 60_000;
