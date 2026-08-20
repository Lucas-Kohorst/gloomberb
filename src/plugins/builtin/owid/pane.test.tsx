import { afterEach, describe, expect, test } from "bun:test";
import { act, useReducer } from "react";
import { testRender } from "../../../renderers/opentui/test-utils";
import {
  AppContext,
  PaneInstanceProvider,
  appReducer,
  createInitialState,
} from "../../../state/app/context";
import { createTestPluginRuntime } from "../../../test-support/plugin-runtime";
import { createDefaultConfig } from "../../../types/config";
import { setHttpFetchTransport } from "../../../utils/http-transport";
import { PluginRenderProvider } from "../../runtime";
import { OwidPane } from "./pane";

const PANE_ID = "owid-pane-test";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(async () => {
  if (testSetup) {
    await act(async () => {
      testSetup!.renderer.destroy();
    });
    testSetup = undefined;
  }
  setHttpFetchTransport(null);
  delete (globalThis as { __GLOOM_CLOUD_HOSTED?: boolean }).__GLOOM_CLOUD_HOSTED;
});

function Harness() {
  const initialState = createInitialState(createDefaultConfig("/tmp/gloomberb-owid-pane-test"));
  initialState.focusedPaneId = PANE_ID;
  const [state, dispatch] = useReducer(appReducer, initialState);

  return (
    <AppContext value={{ state, dispatch }}>
      <PaneInstanceProvider paneId={PANE_ID}>
        <PluginRenderProvider pluginId="adjacent" runtime={createTestPluginRuntime()}>
          <OwidPane
            paneId={PANE_ID}
            paneType="owid"
            focused
            width={88}
            height={20}
          />
        </PluginRenderProvider>
      </PaneInstanceProvider>
    </AppContext>
  );
}

async function renderFrames(count = 6) {
  for (let index = 0; index < count; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await testSetup!.renderOnce();
    });
  }
}

describe("OWID pane", () => {
  test("lists grapher search hits from the public origin", async () => {
    delete (globalThis as { __GLOOM_CLOUD_HOSTED?: boolean }).__GLOOM_CLOUD_HOSTED;
    const payload = {
      nbHits: 1,
      results: [{
        title: "Life expectancy",
        slug: "life-expectancy",
        subtitle: "over the long-run",
        url: "https://ourworldindata.org/grapher/life-expectancy",
        availableEntities: ["United States"],
      }],
    };
    const respond = async (url: URL | RequestInfo) => {
      const href = String(url);
      if (href.includes("/api/search") || href.includes("/api/data/owid/charts")) {
        return Response.json(payload);
      }
      return new Response("missing", { status: 404 });
    };
    setHttpFetchTransport(respond);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = respond as typeof fetch;
    try {
      await act(async () => {
        testSetup = await testRender(<Harness />, { width: 96, height: 22 });
      });
      await renderFrames();
      const frame = testSetup!.captureCharFrame();
      expect(frame).toContain("Life expectancy");
      expect(frame).toContain("life-expectancy");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
