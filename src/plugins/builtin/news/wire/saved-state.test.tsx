import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "../../../../renderers/opentui/test-utils";
import { createStatefulTestPluginRuntime } from "../../../../test-support/plugin-runtime";
import { PluginRenderProvider } from "../../../runtime";
import {
  MAX_READ_ARTICLE_IDS,
  useNewsReadState,
} from "./read-state";
import {
  MAX_SAVED_ARTICLE_IDS,
  filterSavedNewsArticles,
  markNewsArticleSaved,
  normalizeNewsSavedState,
  toggleNewsArticleSaved,
  unmarkNewsArticleSaved,
  useNewsSavedState,
  type NewsSavedState,
} from "./saved-state";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(async () => {
  if (testSetup) {
    await act(async () => {
      testSetup!.renderer.destroy();
    });
    testSetup = undefined;
  }
});

describe("news saved state", () => {
  test("marks saved articles with the most recent first", () => {
    const state = markNewsArticleSaved({ articleIds: ["old"] }, "new");

    expect(state.articleIds).toEqual(["new", "old"]);
  });

  test("deduplicates existing saved articles when re-saved", () => {
    const state = markNewsArticleSaved({ articleIds: ["a", "b", "a"] }, "b");

    expect(state.articleIds).toEqual(["b", "a"]);
  });

  test("unmarks only the requested article and keeps the rest in order", () => {
    const state = unmarkNewsArticleSaved({ articleIds: ["a", "b", "c"] }, "b");

    expect(state.articleIds).toEqual(["a", "c"]);
  });

  test("unmarking an article that is not saved keeps the state as-is", () => {
    const state: NewsSavedState = { articleIds: ["a"] };

    expect(unmarkNewsArticleSaved(state, "missing")).toBe(state);
  });

  test("toggles an article into and out of the saved set", () => {
    const saved = toggleNewsArticleSaved({ articleIds: [] }, "story");
    expect(saved.articleIds).toEqual(["story"]);

    const unsaved = toggleNewsArticleSaved(saved, "story");
    expect(unsaved.articleIds).toEqual([]);
  });

  test("re-saving an existing article moves it to the front instead of duplicating", () => {
    const state = markNewsArticleSaved({ articleIds: ["b", "a"] }, "a");

    expect(state.articleIds).toEqual(["a", "b"]);
  });

  test("keeps persisted saved state bounded by its own cap", () => {
    const state = normalizeNewsSavedState({
      articleIds: Array.from({ length: MAX_SAVED_ARTICLE_IDS + 25 }, (_, index) => `id-${index}`),
    });

    expect(state.articleIds).toHaveLength(MAX_SAVED_ARTICLE_IDS);
    expect(state.articleIds[0]).toBe("id-0");
    expect(state.articleIds.at(-1)).toBe(`id-${MAX_SAVED_ARTICLE_IDS - 1}`);
  });

  test("repairs persisted state with a missing article list", () => {
    const state = normalizeNewsSavedState({} as NewsSavedState);

    expect(state).toEqual({ articleIds: [] });
  });
});

describe("filterSavedNewsArticles", () => {
  const articles = [{ id: "a" }, { id: "b" }, { id: "c" }];

  test("keeps only saved articles in pool order", () => {
    expect(filterSavedNewsArticles(articles, new Set(["c", "a"]))).toEqual([
      { id: "a" },
      { id: "c" },
    ]);
  });

  test("ignores saved ids whose article is no longer loaded", () => {
    expect(filterSavedNewsArticles(articles, new Set(["ghost"]))).toEqual([]);
  });

  test("returns an empty list without saving anything", () => {
    expect(filterSavedNewsArticles(articles, new Set())).toEqual([]);
  });
});

describe("useNewsSavedState persistence", () => {
  test("persists under its own key, separate from read state, and survives read-cap churn", async () => {
    const runtime = createStatefulTestPluginRuntime();
    runtime.setResumeState("news", "saved-articles", { articleIds: ["seeded"] }, 1);

    let readState: ReturnType<typeof useNewsReadState> | null = null;
    let savedState: ReturnType<typeof useNewsSavedState> | null = null;

    function Probe() {
      readState = useNewsReadState();
      savedState = useNewsSavedState();
      return <text>saved-state-probe</text>;
    }

    await act(async () => {
      testSetup = await testRender(
        <PluginRenderProvider pluginId="news" runtime={runtime}>
          <Probe />
        </PluginRenderProvider>,
        { width: 40, height: 5 },
      );
      await testSetup.renderOnce();
    });

    // Reads persisted saved ids on mount.
    expect(savedState!.savedArticleIds.has("seeded")).toBe(true);

    await act(async () => {
      savedState!.toggleArticleSaved("fresh");
      readState!.markArticleRead("read-once");
    });

    // Saved and read markers persist through the same resume-state route, each
    // under its own key, so neither can evict the other.
    expect(runtime.getResumeState("news", "saved-articles", 1)).toEqual({
      articleIds: ["fresh", "seeded"],
    });
    expect(runtime.getResumeState("news", "read-articles", 1)).toEqual({
      articleIds: ["read-once"],
    });

    await act(async () => {
      runtime.setResumeState(
        "news",
        "read-articles",
        {
          articleIds: Array.from(
            { length: MAX_READ_ARTICLE_IDS + 5 },
            (_, index) => `read-${index}`,
          ),
        },
        1,
      );
    });

    // The read list is capped on read; the saved list is untouched by that churn.
    expect(readState!.readArticleIds.size).toBe(MAX_READ_ARTICLE_IDS);
    expect(savedState!.savedArticleIds.has("fresh")).toBe(true);
    expect(savedState!.savedArticleIds.has("seeded")).toBe(true);

    await act(async () => {
      savedState!.toggleArticleSaved("fresh");
    });

    expect(runtime.getResumeState("news", "saved-articles", 1)).toEqual({
      articleIds: ["seeded"],
    });
  });
});
