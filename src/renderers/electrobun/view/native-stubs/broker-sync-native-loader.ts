export function loadRobinhoodNativeModule(): Promise<never> {
  return Promise.reject(new Error(
    "Robinhood sign-in uses a local browser callback, so sync is available in the desktop and terminal apps.",
  ));
}
