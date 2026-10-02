import { afterEach, describe, expect, test } from "bun:test";
import { act, useReducer } from "react";
import { PaneFooterBar, PaneFooterProvider } from "../../../components/layout/pane/footer";
import { testRender } from "../../../renderers/opentui/test-utils";
import { AppContext, PaneInstanceProvider, appReducer, createInitialState } from "../../../state/app/context";
import { MemoryPluginPersistence } from "../../../test-support/plugin-persistence";
import { createStatefulTestPluginRuntime } from "../../../test-support/plugin-runtime";
import { createDefaultConfig } from "../../../types/config";
import { Box } from "../../../ui";
import { PluginRenderProvider } from "../../runtime";
import { SubstackArticleReaderPane } from "./article-reader";
import {
  attachSubstackPersistence,
  resetSubstackPersistence,
  setSubstackFetchTransportForTests,
} from "./api/store";
import { SubstackPane } from "./pane";
import type { SubstackArticleSummary, SubstackPublication } from "./types";

const PANE_ID = "substack:test";
const ARTICLE_READER_PANE_ID = "substack-article:cached-1";
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

async function emitKeypress(name: string, sequence: string) {
  await act(async () => {
    testSetup!.renderer.keyInput.emit("keypress", {
      name,
      sequence,
      ctrl: false,
      meta: false,
      option: false,
      shift: false,
      eventType: "press",
      repeated: false,
      preventDefault: () => {},
      stopPropagation: () => {},
    } as any);
    await testSetup!.renderOnce();
  });
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
  const runtime = createStatefulTestPluginRuntime();

  function Harness() {
    const [current, dispatch] = useReducer(appReducer, state);
    return (
      <AppContext value={{ state: current, dispatch }}>
        <PaneInstanceProvider paneId={PANE_ID}>
          <PluginRenderProvider pluginId="substack" runtime={runtime}>
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
  return <Harness />;
}

function createArticleReaderHarness() {
  const config = createDefaultConfig("/tmp/gloomberb-substack-article-reader");
  config.refreshIntervalMinutes = 0;
  config.layout.instances.push({
    instanceId: ARTICLE_READER_PANE_ID,
    paneId: "substack-article",
    title: "Cached Substack post",
    settings: {
      articleId: cachedArticle.id,
      title: cachedArticle.title,
      url: cachedArticle.url,
      source: cachedArticle.publicationName,
    },
  });
  const state = createInitialState(config);
  state.focusedPaneId = ARTICLE_READER_PANE_ID;
  const runtime = createStatefulTestPluginRuntime();

  function Harness() {
    const [current, dispatch] = useReducer(appReducer, state);
    return (
      <AppContext value={{ state: current, dispatch }}>
        <PaneInstanceProvider paneId={ARTICLE_READER_PANE_ID}>
          <PluginRenderProvider pluginId="substack" runtime={runtime}>
            <PaneFooterProvider>
              {(footer) => (
                <Box flexDirection="column" width={WIDTH} height={HEIGHT}>
                  <SubstackArticleReaderPane focused width={WIDTH} height={HEIGHT - 1} />
                  <PaneFooterBar footer={footer} focused width={WIDTH} />
                </Box>
              )}
            </PaneFooterProvider>
          </PluginRenderProvider>
        </PaneInstanceProvider>
      </AppContext>
    );
  }
  return <Harness />;
}

function seedAuthenticatedCache(publications = [publication]) {
  const persistence = new MemoryPluginPersistence();
  attachSubstackPersistence(persistence);
  persistence.setState("auth", {
    email: "reader@example.com",
    sid: "session-secret",
    lli: "1",
    loggedInAt: Date.now(),
  }, { schemaVersion: 1 });
  persistence.seedResource("subscriptions", "me", publications, {
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
  return persistence;
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
  test("publication loading and failure use shared states even when the home feed is cached", async () => {
    let respond!: (response: Response) => void;
    setSubstackFetchTransportForTests(() => new Promise<Response>((resolve) => { respond = resolve; }));
    seedAuthenticatedCache([publication, {
      ...publication, id: "pub-2", name: "Uncached", subdomain: "uncached", baseUrl: "https://uncached.substack.com",
    }]);
    testSetup = await testRender(createHarness(), { width: WIDTH, height: HEIGHT });
    async function settle() {
      for (let frame = 0; frame < 4; frame++) {
        await act(async () => {
          await Bun.sleep(0);
          await testSetup!.renderOnce();
        });
      }
    }
    await settle();
    const tab = findText(testSetup.captureCharFrame(), "Uncached");
    expect(tab).not.toBeNull();
    await act(async () => { await testSetup!.mockMouse.click(tab!.col + 1, tab!.row); });
    await settle();
    expect(testSetup.captureCharFrame()).toContain("Loading Uncached");
    expect(testSetup.captureCharFrame()).not.toContain("No Substack posts");
    await act(async () => { respond(new Response("Unavailable", { status: 503 })); });
    await settle();
    expect(testSetup.captureCharFrame()).toContain("Uncached unavailable");
    expect(testSetup.captureCharFrame()).not.toContain("No Substack posts");
    const feed = findText(testSetup.captureCharFrame(), "Feed");
    await act(async () => { await testSetup!.mockMouse.click(feed!.col + 1, feed!.row); });
    await settle();
    expect(testSetup.captureCharFrame()).toContain("Cached Substack post");
  });

  test("r force-refetches the cached home feed without a per-pane refresh hint", async () => {
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
    await act(async () => { await testSetup!.renderOnce(); });

    expect(testSetup!.captureCharFrame()).toContain("Cached Substack post");
    expect(testSetup!.captureCharFrame()).not.toContain("[r]efresh");
    expect(urls).toEqual([]);

    await act(async () => {
      testSetup!.mockInput.pressKey("r");
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

  test("a failed detail refresh keeps the cached article readable", async () => {
    const requests: string[] = [];
    setSubstackFetchTransportForTests(async (url) => {
      requests.push(url);
      return new Response("temporarily unavailable", { status: 503 });
    });
    const persistence = seedAuthenticatedCache();
    persistence.seedResource("post", cachedArticle.id, {
      ...cachedArticle,
      contentText: "Cached full article body remains readable after refresh failure.",
      contentBlocks: [{ type: "paragraph", text: "Cached full article body remains readable after refresh failure." }],
      linkUrls: [],
    }, { sourceKey: "substack", schemaVersion: 4 });

    testSetup = await testRender(createHarness(), { width: WIDTH, height: HEIGHT });
    async function settle() {
      for (let frame = 0; frame < 5; frame += 1) {
        await act(async () => {
          await Bun.sleep(0);
          await testSetup!.renderOnce();
        });
      }
    }
    await settle();
    const article = findText(testSetup.captureCharFrame(), "Cached Substack post");
    expect(article).not.toBeNull();
    await act(async () => { await testSetup!.mockMouse.click(article!.col + 1, article!.row); });
    await emitKeypress("enter", "\r");
    await settle();
    expect(testSetup.captureCharFrame()).toContain("Cached full article body remains readable");

    await act(async () => { testSetup!.mockInput.pressKey("r"); });
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await act(async () => {
        await Bun.sleep(10);
        await testSetup!.renderOnce();
      });
      if (testSetup.captureCharFrame().includes("Substack HTTP 503")) break;
    }
    const frame = testSetup.captureCharFrame();
    expect(requests.length).toBeGreaterThan(0);
    expect(frame).toContain("Cached full article body remains readable");
    expect(frame).toContain("Substack HTTP 503");
  });
});

describe("Substack article reader refresh", () => {
  test("a failed refresh keeps the popped-out article body and displays unavailable status", async () => {
    const requests: string[] = [];
    setSubstackFetchTransportForTests(async (url) => {
      requests.push(url);
      return new Response("temporarily unavailable", { status: 503 });
    });
    const persistence = seedAuthenticatedCache();
    const body = `Cached popped-out article remains readable. ${"Long article content for scrollable reading. ".repeat(12)}`;
    persistence.seedResource("post", cachedArticle.id, {
      ...cachedArticle,
      contentText: body,
      contentBlocks: [{ type: "paragraph", text: body }],
      linkUrls: [],
    }, { sourceKey: "substack", schemaVersion: 4 });

    testSetup = await testRender(createArticleReaderHarness(), { width: WIDTH, height: HEIGHT });
    async function settle() {
      for (let frame = 0; frame < 5; frame += 1) {
        await act(async () => {
          await Bun.sleep(0);
          await testSetup!.renderOnce();
        });
      }
    }
    await settle();
    expect(testSetup.captureCharFrame()).toContain("Cached popped-out article remains readable");

    await act(async () => { testSetup!.mockInput.pressKey("r"); });
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await act(async () => {
        await Bun.sleep(10);
        await testSetup!.renderOnce();
      });
      if (testSetup.captureCharFrame().includes("unavailable")) break;
    }
    const frame = testSetup.captureCharFrame();
    expect(requests.length).toBeGreaterThan(0);
    expect(frame).toContain("Cached popped-out article remains readable");
    expect(frame).toContain("unavailable");
  });
});
