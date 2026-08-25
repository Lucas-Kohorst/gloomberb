export function loadRobinhoodNativeModule(): Promise<
  typeof import("../../../../plugins/broker-sync/robinhood-browser")
> {
  return import("../../../../plugins/broker-sync/robinhood-browser");
}
