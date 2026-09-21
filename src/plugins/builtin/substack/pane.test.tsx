import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { PaneFooterBar, PaneFooterProvider } from "../../../components/layout/pane/footer";
import { testRender } from "../../../renderers/opentui/test-utils";
import { AppContext, PaneInstanceProvider, createInitialState } from "../../../state/app/context";
import { MemoryPluginPersistence } from "../../../test-support/plugin-persistence";
import { createStatefulTestPluginRuntime } from "../../../test-support/plugin-runtime";
import { createDefaultConfig } from "../../../types/config";
import { Box } from "../../../ui";
import { PluginRenderProvider } from "../../runtime";
import {
  attachSubstackPersistence,
  resetSubstackPersistence,
  setSubstackFetchTransportForTests,
} from "./api/store";
import { SubstackPane } from "./pane";
import type { SubstackArticleSummary, SubstackPublication } from "./types";

const PANE_ID = "substack:test";
const WIDTH = 100;
const HEIGHT = 24;

const publication: SubstackPublication = {
  id: "pub-1",
  name: "Example",
  subdomain: "example",
  baseUrl: "https://example.substack.com",
  description: null,
  logoUrl: null,
  latestPublishedAt: "2026-09-20T12:00:00.000Z",
};

const cachedArticle: SubstackArticleSummary = {
  id: "cached-1",
  title: "Cached Substack post",
  publicationId: publication.id,
  publicationName: publication.name,
  publicationSubdomain: publication.subdomain,
  publicationBaseUrl: publication.baseUrl,
  url: "https://example.substack.com/p/cached",
  slug: "cached",
  publishedAt: "2026-09-20T12:00:00.000Z",
  subtitle: null,
  previewText: "cached preview",
  bodyHtml: null,
  imageUrls: [],
  wordCount: 12,
  readMinutes: 1,
};

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

function findText(frame: string, needle: string): { col: number; row: number } | null {
  const lines = frame.split("\n");
  for (let row = 0; row < lines.length; row += 1) {
    const col = lines[row]!.indexOf(needle);
    if (col >= 0) return { col, row };
  }
  return null;
}

function createHarness() {
  const config = createDefaultConfig("/tmp/gloomberb-substack-pane");
  config.refreshIntervalMinutes = 0;
  config.layout.instances.push({
    instanceId: PANE_ID,
    paneId: "substack",
    title: "Substack",
  });
  const state = createInitialState(config);
  state.focusedPaneId = PANE_ID;

  return (
    <AppContext value={{ state, dispatch: () => {} }}>
      <PaneInstanceProvider paneId={PANE_ID}>
        <PluginRenderProvider pluginId="substack" runtime={createStatefulTestPluginRuntime()}>
          <PaneFooterProvider>
            {(footer) => (
              <Box flexDirection="column" width={WIDTH} height={HEIGHT}>
                <SubstackPane focused width={WIDTH} height={HEIGHT - 1} />
                <PaneFooterBar footer={footer} focused width={WIDTH} />
              </Box>
            )}
          </PaneFooterProvider>
        </PluginRenderProvider>
      </PaneInstanceProvider>
    </AppContext>
  );
}

function seedAuthenticatedCache() {
  const persistence = new MemoryPluginPersistence();
  attachSubstackPersistence(persistence);
  persistence.setState("auth", {
    email: "reader@example.com",
    sid: "session-secret",
    lli: "1",
    loggedInAt: Date.now(),
  }, { schemaVersion: 1 });
  persistence.seedResource("subscriptions", "me", [publication], {
    sourceKey: "substack",
    schemaVersion: 4,
  });
  persistence.seedResource("feed", "subscribed", {
    items: [cachedArticle],
    nextCursor: null,
  }, {
    sourceKey: "substack",
    schemaVersion: 4,
  });
}

afterEach(async () => {
  setSubstackFetchTransportForTests(null);
  resetSubstackPersistence();
  if (testSetup) {
    await act(async () => {
      testSetup!.renderer.destroy();
    });
    testSetup = undefined;
  }
});

describe("SubstackPane refresh", () => {
  test("clicking Refresh force-refetches the home feed", async () => {
    const urls: string[] = [];
    setSubstackFetchTransportForTests(async (url) => {
      urls.push(url);
      if (url.includes("/api/v1/subscriptions")) {
        return new Response(JSON.stringify({ publications: [publication] }), { status: 200 });
      }
      if (url.includes("/api/v1/reader/feed")) {
        return new Response(JSON.stringify({
          items: [{
            id: "fresh-1",
            title: "Fresh Substack post",
            canonical_url: "https://example.substack.com/p/fresh",
            post_date: "2026-09-21T14:00:00.000Z",
            publication,
          }],
        }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
    seedAuthenticatedCache();

    await act(async () => {
      testSetup = await testRender(createHarness(), { width: WIDTH, height: HEIGHT });
      await testSetup.renderOnce();
      await testSetup.renderOnce();
    });

    expect(testSetup!.captureCharFrame()).toContain("Cached Substack post");
    expect(testSetup!.captureCharFrame()).toContain("Refresh");
    expect(testSetup!.captureCharFrame()).not.toContain("[r]efresh");
    expect(urls).toEqual([]);

    const refresh = findText(testSetup!.captureCharFrame(), "Refresh");
    expect(refresh).not.toBeNull();

    await act(async () => {
      await testSetup!.mockMouse.click(refresh!.col + 1, refresh!.row);
    });

    for (let attempt = 0; attempt < 30; attempt += 1) {
      await act(async () => {
        await Bun.sleep(15);
        await testSetup!.renderOnce();
      });
      if (testSetup!.captureCharFrame().includes("Fresh Substack post")) break;
    }

    expect(urls.some((url) => url.includes("/api/v1/reader/feed"))).toBe(true);
    expect(urls.some((url) => url.includes("/api/v1/subscriptions"))).toBe(true);
    expect(testSetup!.captureCharFrame()).toContain("Fresh Substack post");
  });
});
