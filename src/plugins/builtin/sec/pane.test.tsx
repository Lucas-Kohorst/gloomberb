import { afterEach, expect, spyOn, test } from "bun:test";
import { act } from "react";
import { PaneFooterProvider } from "../../../components/layout/pane/footer";
import { testRender } from "../../../renderers/opentui/test-utils";
import { AppContext, createInitialState, PaneInstanceProvider } from "../../../state/app/context";
import { createDefaultConfig } from "../../../types/config";
import * as client from "./client";
import { PluginRenderProvider } from "../../runtime";
import { createTestPluginRuntime } from "../../../test-support/plugin-runtime";
import { secModule } from "./index";

let setup: Awaited<ReturnType<typeof testRender>> | undefined;
let fetchSpy: ReturnType<typeof spyOn<typeof client, "loadSecBrowserFilings">> | undefined;
afterEach(async () => {
  await act(async () => setup?.renderer.destroy());
  setup = undefined;
  fetchSpy?.mockRestore();
});

for (const forms of ["10-K,10-Q", "N-1A,485BPOS"]) {
  test(`SEC ${forms} fetch settles after completion`, async () => {
    fetchSpy = spyOn(client, "loadSecBrowserFilings").mockResolvedValue([]);
    const paneId = "sec-test";
    const config = createDefaultConfig("/tmp/gloom-sec-test");
    config.layout = {
      dockRoot: { kind: "pane", instanceId: paneId },
      instances: [{ instanceId: paneId, paneId: "sec", settings: { forms } }],
      floating: [], detached: [],
    };
    const state = createInitialState(config);
    const Pane = secModule.panes![0]!.component;
    setup = await testRender(
      <AppContext value={{ state, dispatch: () => {} }}>
        <PaneInstanceProvider paneId={paneId}>
          <PluginRenderProvider pluginId="sec" runtime={createTestPluginRuntime()}><PaneFooterProvider>{() => <Pane paneId={paneId} paneType="sec" focused width={100} height={30} />}</PaneFooterProvider></PluginRenderProvider>
        </PaneInstanceProvider>
      </AppContext>, { width: 100, height: 30 },
    );
    for (let i = 0; i < 8; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        await setup!.renderOnce();
      });
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[1]?.forms).toEqual(forms.split(","));
  });
}
