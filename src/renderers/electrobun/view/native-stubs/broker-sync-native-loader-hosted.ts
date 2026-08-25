/**
 * Hosted Connect must not `import()` robinhood-browser through Bun splitting.
 * That graph (MCP SDK + Zod) emits minified uses of `util.mergeDefs` without
 * importing `util`, which the Connect Broker dialog shows as `Y0 is not defined`.
 *
 * The web client build writes an unsplit `robinhood-browser.<hash>.js` and
 * points this loader at it via `window.__GLOOM_ROBINHOOD_BROWSER_SRC`.
 */
export function loadRobinhoodNativeModule(): Promise<
  typeof import("../../../../plugins/broker-sync/robinhood-browser")
> {
  const src = (globalThis as { __GLOOM_ROBINHOOD_BROWSER_SRC?: string }).__GLOOM_ROBINHOOD_BROWSER_SRC;
  if (!src) {
    return Promise.reject(new Error("Robinhood connect bundle is missing. Reload the page."));
  }
  return import(src) as Promise<typeof import("../../../../plugins/broker-sync/robinhood-browser")>;
}
