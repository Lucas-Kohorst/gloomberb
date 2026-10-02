import { afterEach, expect, spyOn, test } from "bun:test";
import { act } from "react";
import { PaneFooterProvider, type CombinedPaneFooter } from "../../../components/layout/pane/footer";
import { testRender } from "../../../renderers/opentui/test-utils";
import { AppContext, createInitialState, PaneInstanceProvider } from "../../../state/app/context";
import { createDefaultConfig } from "../../../types/config";
import { PluginRenderProvider } from "../../runtime";
import { createTestPluginRuntime } from "../../../test-support/plugin-runtime";
import { CourtListenerClient } from "./client";
import { CourtListenerPane } from "./pane";
import type { Lawsuit } from "./types";

let setup: Awaited<ReturnType<typeof testRender>> | undefined;
const spies: Array<{ mockRestore(): void }> = [];
afterEach(async () => {
  await act(async () => setup?.renderer.destroy());
  setup = undefined;
  for (const spy of spies.splice(0)) spy.mockRestore();
});
async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await setup!.renderOnce();
  });
}
const lawsuit = (id: string): Lawsuit => ({
  id, kind: "docket", clusterId: "", opinionId: "", docketId: id,
  caseName: `Case ${id}`, court: "Test Court", courtCitation: "TC",
  dateFiled: new Date("2026-01-01"), docketNumber: id, judge: "", status: "",
  snippet: "", citeCount: 0, url: "", downloadUrl: "",
});

test("pagination retry deduplicates results and refresh failure preserves readable rows", async () => {
  const next = "https://www.courtlistener.com/api/rest/v4/search/?cursor=second";
  const searchSpy = spyOn(CourtListenerClient.prototype, "searchLawsuits").mockResolvedValue({
    lawsuits: Array.from({ length: 30 }, (_, i) => lawsuit(String(i))), total: 31, next,
  });
  spies.push(searchSpy);
  const pageSpy = spyOn(CourtListenerClient.prototype, "searchLawsuitsPage")
    .mockRejectedValueOnce(new Error("Rate limit reached"))
    .mockResolvedValue({ lawsuits: [lawsuit("29"), lawsuit("final"), lawsuit("final")], total: 31, next: null });
  spies.push(pageSpy);
  const paneId = "court-test";
  const config = createDefaultConfig("/tmp/gloom-court-test");
  config.layout = {
    dockRoot: { kind: "pane", instanceId: paneId },
    instances: [{ instanceId: paneId, paneId: "courtlistener", settings: {} }],
    floating: [], detached: [],
  };
  let footer: CombinedPaneFooter;
  await act(async () => { setup = await testRender(
    <AppContext value={{ state: createInitialState(config), dispatch: () => {} }}>
      <PaneInstanceProvider paneId={paneId}>
        <PluginRenderProvider pluginId="courtlistener" runtime={createTestPluginRuntime()}>
          <PaneFooterProvider>{(value) => {
            footer = value;
            return <CourtListenerPane paneId={paneId} paneType="courtlistener" focused width={100} height={15} />;
          }}</PaneFooterProvider>
        </PluginRenderProvider>
      </PaneInstanceProvider>
    </AppContext>, { width: 100, height: 15 },
  ); });
  await settle();
  for (let i = 0; i < 30; i++) {
    await act(async () => { setup!.mockInput.pressArrow("down"); await setup!.renderOnce(); });
  }
  await settle();
  expect(pageSpy).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(footer!.info)).toContain("Rate limit reached");
  expect(setup.captureCharFrame()).toContain("Case");
  for (let i = 0; i < 5; i++) {
    await act(async () => { setup!.mockInput.pressArrow("down"); await setup!.renderOnce(); });
  }
  await settle();
  expect(pageSpy).toHaveBeenCalledTimes(1);
  const retry = footer!.hints.find((hint) => hint.id === "retry-page");
  expect(retry).toBeDefined();
  await act(async () => { retry!.onPress!(); });
  await settle();
  expect(pageSpy).toHaveBeenCalledTimes(2);
  expect(pageSpy.mock.calls.map(([url]) => url)).toEqual([next, next]);
  expect(JSON.stringify(footer!.info)).not.toContain("Rate limit reached");
  expect(footer!.hints.some((hint) => hint.id === "retry-page")).toBe(false);
  await act(async () => { setup!.mockInput.pressArrow("down"); });
  await settle();
  expect(setup.captureCharFrame().match(/Case final/g)).toHaveLength(1);
  searchSpy.mockRejectedValueOnce(new Error("Refresh unavailable"));
  await act(async () => { setup!.mockInput.pressKey("r"); });
  await settle();
  expect(searchSpy).toHaveBeenCalledTimes(2);
  expect(setup.captureCharFrame()).toContain("Case final");
  expect(JSON.stringify(footer!.info)).toContain("unavailable");
  await act(async () => { setup!.mockInput.pressEnter(); });
  await settle();
  expect(setup.captureCharFrame()).toContain("← Back │ Case");
  expect(setup.captureCharFrame()).toContain("No excerpt available.");
});
