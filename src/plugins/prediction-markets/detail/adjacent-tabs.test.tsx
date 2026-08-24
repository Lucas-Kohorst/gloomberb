import { afterEach, describe, expect, test } from "bun:test";
import { act, useMemo, useReducer } from "react";
import { PaneFooterBar, PaneFooterProvider } from "../../../components/layout/pane/footer";
import { testRender } from "../../../renderers/opentui/test-utils";
import {
  AppContext,
  appReducer,
  createInitialState,
  PaneInstanceProvider,
} from "../../../state/app/context";
import { createStatefulTestPluginRuntime } from "../../../test-support/plugin-runtime";
import { createDefaultConfig } from "../../../types/config";
import { Box } from "../../../ui";
import type { AdjacentClient } from "../../builtin/adjacent/client";
import type { AdjacentMarket, AdjacentNewsArticle } from "../../builtin/adjacent/types";
import { PluginRenderProvider } from "../../runtime";
import { flushFrames } from "../test-helpers";
import { PredictionNewsTab } from "./adjacent-tabs";
import { resetAdjacentMarketMatchCache } from "./adjacent-match";

const PANE_ID = "prediction-markets:main";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

function market(id: string): AdjacentMarket {
  return {
    id,
    platform: "kalshi",
    title: "Will the Fed cut rates?",
    status: "active",
    yes_price: 48,
    no_price: 52,
  };
}

function newsArticle(): AdjacentNewsArticle {
  return {
    id: "hormuz-1",
    title: "Iran won’t reopen Strait of Hormuz without US concessions",
    url: "https://apnews.com/hormuz",
    source: "Associated Press",
    published_at: "2026-08-10T10:58:24Z",
    summary: "Tehran tied reopening the strait to a broader security deal.",
    categories: ["geopolitical"],
  };
}

function fakeNewsClient(): AdjacentClient {
  const matched = market("kalshi:KXTEST-1");
  return {
    async getMarket(id: string) {
      if (id === matched.id) return matched;
      throw new Error(`Adjacent request failed (404) for ${id}`);
    },
    async searchMarketsByText() {
      return [];
    },
    async searchMarkets() {
      return { markets: [] };
    },
    async getMarketNews() {
      return { news: [newsArticle()] };
    },
  } as unknown as AdjacentClient;
}

function NewsTabHarness({ client }: { client: AdjacentClient }) {
  const runtime = useMemo(() => createStatefulTestPluginRuntime(), []);
  const [state, dispatch] = useReducer(
    appReducer,
    (() => {
      const config = createDefaultConfig("/tmp/gloomberb-pm-news-tab");
      config.layout.instances.push({
        instanceId: PANE_ID,
        paneId: "prediction-markets",
        title: "Prediction Markets",
      });
      const initial = createInitialState(config);
      initial.focusedPaneId = PANE_ID;
      return initial;
    })(),
  );

  return (
    <AppContext value={{ state, dispatch }}>
      <PaneInstanceProvider paneId={PANE_ID}>
        <PluginRenderProvider pluginId="prediction-markets" runtime={runtime}>
          <PaneFooterProvider>
            {(footer) => (
              <Box flexDirection="column" width={90} height={18}>
                <PredictionNewsTab
                  client={client}
                  lookup={{
                    venue: "kalshi",
                    marketId: "KXTEST-1",
                    title: "Will the Fed cut rates?",
                  }}
                  focused
                  width={90}
                  height={16}
                />
                <PaneFooterBar footer={footer} focused width={90} />
              </Box>
            )}
          </PaneFooterProvider>
        </PluginRenderProvider>
      </PaneInstanceProvider>
    </AppContext>
  );
}

afterEach(async () => {
  resetAdjacentMarketMatchCache();
  if (testSetup) {
    await act(async () => {
      testSetup!.renderer.destroy();
    });
    testSetup = undefined;
  }
});

describe("PredictionNewsTab", () => {
  test("renders related news in the shared news table with article footer actions", async () => {
    testSetup = await testRender(<NewsTabHarness client={fakeNewsClient()} />, {
      width: 90,
      height: 18,
    });

    await act(async () => {
      await Bun.sleep(20);
    });
    await flushFrames(testSetup, 8);

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Headline");
    expect(frame).toContain("Source");
    expect(frame).toContain("Iran");
    expect(frame).toContain("[o]");
    expect(frame).toContain("[p]");
    expect(frame).toContain("[a]");
    expect(frame).not.toContain("Tehran tied reopening");
  });
});
