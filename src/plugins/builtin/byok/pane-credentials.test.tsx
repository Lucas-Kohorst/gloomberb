import { afterEach, expect, spyOn, test } from "bun:test";
import { act, type ComponentType } from "react";
import { PaneFooterProvider } from "../../../components/layout/pane/footer";
import { testRender } from "../../../renderers/opentui/test-utils";
import { AppContext, createInitialState, PaneInstanceProvider } from "../../../state/app/context";
import { createDefaultConfig } from "../../../types/config";
import type { PaneProps } from "../../../types/plugin";
import { PluginRenderProvider } from "../../runtime";
import { createTestPluginRuntime } from "../../../test-support/plugin-runtime";
import { nasaFirmsPlugin } from "../nasa-firms";
import { FirmsClient } from "../nasa-firms/client";
import { EnergyPane } from "../eia-energy/pane";
import { adjacentPlugin } from "../adjacent";
import { AdjacentClient } from "../adjacent/client";
import * as http from "../../../utils/http-transport";

let setup: Awaited<ReturnType<typeof testRender>> | undefined;
const spies: Array<{ mockRestore(): void }> = [];
const env = new Map<string, string | undefined>();
afterEach(async () => {
  await act(async () => setup?.renderer.destroy());
  setup = undefined;
  for (const spy of spies.splice(0)) spy.mockRestore();
  for (const [key, value] of env) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  env.clear();
});
async function renderPane(Pane: ComponentType<PaneProps>, pluginId: string) {
  const config = createDefaultConfig("/tmp/gloom-credential-test");
  config.layout = {
    dockRoot: { kind: "pane", instanceId: pluginId },
    instances: [{ instanceId: pluginId, paneId: pluginId, settings: {} }],
    floating: [], detached: [],
  };
  setup = await testRender(
    <AppContext value={{ state: createInitialState(config), dispatch: () => {} }}>
      <PaneInstanceProvider paneId={pluginId}>
        <PluginRenderProvider pluginId={pluginId} runtime={createTestPluginRuntime()}>
          <PaneFooterProvider>{() => <Pane paneId={pluginId} paneType={pluginId} focused width={100} height={20} />}</PaneFooterProvider>
        </PluginRenderProvider>
      </PaneInstanceProvider>
    </AppContext>, { width: 100, height: 20 },
  );
  for (let i = 0; i < 20; i++) await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await setup!.renderOnce();
  });
}
function setEnv(name: string) {
  env.set(name, process.env[name]);
  process.env[name] = "  environment-test-key  ";
}

test("FIRMS environment key passes the pane auth gate and reaches its client", async () => {
  setEnv("NASA_FIRMS_MAP_KEY");
  const keys: Array<string | undefined> = [];
  spies.push(spyOn(FirmsClient.prototype, "getFiresByCountry").mockImplementation(async function(this: FirmsClient) {
    keys.push(this.mapKey);
    return { detections: [], total: 0 };
  }));
  await renderPane(nasaFirmsPlugin.panes![0]!.component, "nasa-firms");
  expect(keys).toEqual(["environment-test-key"]);
  expect(setup!.captureCharFrame()).not.toContain("key missing");
});

test("EIA pane uses environment credentials instead of the default demo quota", async () => {
  setEnv("EIA_API_KEY");
  const keys: Array<string | null> = [];
  spies.push(spyOn(http, "httpFetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    keys.push(url.searchParams.get("api_key"));
    return Response.json({ response: { data: [] } });
  }));
  await renderPane(EnergyPane, "eia-energy");
  expect(keys).toEqual(["environment-test-key"]);
});

test("Adjacent pane uses the shared environment fallback", async () => {
  setEnv("ADJACENT_API_KEY");
  const keys: Array<string | null | undefined> = [];
  spies.push(spyOn(AdjacentClient.prototype, "getIndices").mockImplementation(async function(this: AdjacentClient) {
    keys.push(this.apiKey);
    return { data: [] };
  }));
  await renderPane(adjacentPlugin.panes![0]!.component, "adjacent");
  expect(keys).toEqual(["environment-test-key"]);
});
