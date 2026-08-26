import { TextAttributes } from "@opentui/core";
import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { Box } from "../../../../../ui";
import { testRender } from "../../../../../renderers/opentui/test-utils";
import {
  AppContext,
  PaneInstanceProvider,
  createInitialState,
} from "../../../../../state/app/context";
import { createDefaultConfig } from "../../../../../types/config";
import { formatNewsCategoryLabel } from "../../../../../news/news-model";
import type { MarketNewsItem } from "../../../../../types/news-source";
import {
  buildNewsArticleRowRevision,
  NEWS_TABLE_MAX_ROWS,
  NewsArticleStackView,
  takeNewsTableHead,
  type NewsSortPreference,
} from "./table";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

const sortPreference: NewsSortPreference = {
  columnId: "time",
  direction: "desc",
};

function makeArticle(overrides: Partial<MarketNewsItem> & { id: string; title: string }): MarketNewsItem {
  const { id, title, ...rest } = overrides;
  return {
    id,
    title,
    url: `https://example.com/${id}`,
    source: "Reuters",
    publishedAt: new Date("2026-04-18T12:00:00Z"),
    summary: "",
    topic: "general",
    topics: [],
    sectors: [],
    categories: [],
    tickers: [],
    scores: {
      importance: 0,
      urgency: 0,
      marketImpact: 0,
      novelty: 0,
      confidence: 0,
    },
    isBreaking: false,
    isDeveloping: false,
    importance: 0,
    ...rest,
  };
}

function Harness() {
  const state = createInitialState(
    createDefaultConfig("/tmp/gloomberb-news-table-test"),
  );

  return (
    <AppContext value={{ state, dispatch: () => {} }}>
      <PaneInstanceProvider paneId="news-feed:main">
        <NewsArticleStackView
          articles={[
            makeArticle({ id: "unread", title: "Unread story" }),
            makeArticle({ id: "read", title: "Read story" }),
          ]}
          focused
          width={90}
          rootHeight={10}
          readArticleIds={new Set(["read"])}
          selectedArticleId="unread"
          setSelectedArticleId={() => {}}
          sortPreference={sortPreference}
          setSortPreference={() => {}}
          onOpenArticle={() => {}}
          detailOpen={false}
          onBack={() => {}}
          detailContent={<Box />}
          columns={["time", "source", "title"]}
          emptyStateTitle="No stories"
        />
      </PaneInstanceProvider>
    </AppContext>
  );
}

afterEach(async () => {
  if (testSetup) {
    await act(async () => {
      testSetup!.renderer.destroy();
    });
    testSetup = undefined;
  }
});

describe("takeNewsTableHead", () => {
  test("returns the same array when it already fits the cap", () => {
    const articles = [
      makeArticle({ id: "a", title: "A" }),
      makeArticle({ id: "b", title: "B" }),
    ];
    expect(takeNewsTableHead(articles)).toBe(articles);
    expect(takeNewsTableHead(articles, 2)).toBe(articles);
  });

  test("caps a 10k-style pool without sorting the tail", () => {
    const many = Array.from({ length: NEWS_TABLE_MAX_ROWS + 50 }, (_, index) => (
      makeArticle({ id: `id-${index}`, title: `Story ${index}` })
    ));
    const head = takeNewsTableHead(many);
    expect(head).toHaveLength(NEWS_TABLE_MAX_ROWS);
    expect(head[0]!.id).toBe("id-0");
    expect(head.at(-1)!.id).toBe(`id-${NEWS_TABLE_MAX_ROWS - 1}`);
    expect(head).not.toBe(many);
  });
});

describe("buildNewsArticleRowRevision", () => {
  test("stays stable when unused article fields change", () => {
    const article = makeArticle({ id: "a", title: "Hello" });
    const first = buildNewsArticleRowRevision(article, false);
    const second = buildNewsArticleRowRevision(
      makeArticle({
        id: "a",
        title: "Hello",
        summary: "updated blurb",
        importance: 88,
        source: "Bloomberg",
      }),
      false,
    );
    expect(first).toBe(second);
  });

  test("changes when title, published time, or read state updates", () => {
    const article = makeArticle({ id: "a", title: "Hello" });
    const base = buildNewsArticleRowRevision(article, false);
    const titled = buildNewsArticleRowRevision(
      makeArticle({ id: "a", title: "Hello!" }),
      false,
    );
    const dated = buildNewsArticleRowRevision(
      makeArticle({
        id: "a",
        title: "Hello",
        publishedAt: new Date("2026-04-19T12:00:00Z"),
      }),
      false,
    );
    const read = buildNewsArticleRowRevision(article, true);
    const override = buildNewsArticleRowRevision(article, false, "Other");
    expect(titled).not.toBe(base);
    expect(dated).not.toBe(base);
    expect(read).not.toBe(base);
    expect(override).not.toBe(base);
  });
});

describe("NewsArticleStackView", () => {
  test("renders unopened stories bold and opened stories normal weight", async () => {
    testSetup = await testRender(<Harness />, { width: 90, height: 10 });

    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const boldText = testSetup.captureSpans().lines
      .flatMap((line) => line.spans)
      .filter((span) => (span.attributes & TextAttributes.BOLD) !== 0)
      .map((span) => span.text)
      .join("");

    expect(boldText).toContain("Unread story");
    expect(boldText).not.toContain("Read story");
  });

  test("dedupes exchange-qualified ticker aliases in table cells", async () => {
    const state = createInitialState(
      createDefaultConfig("/tmp/gloomberb-news-table-ticker-dedupe-test"),
    );

    testSetup = await testRender(
      <AppContext value={{ state, dispatch: () => {} }}>
        <PaneInstanceProvider paneId="news-feed:main">
          <NewsArticleStackView
            articles={[
              makeArticle({
                id: "media",
                title: "Media merger story",
                tickers: ["NFLX", "NFLX:XNAS", "PARA", "PARA:XNAS"],
              }),
            ]}
            focused
            width={90}
            rootHeight={10}
            selectedArticleId="media"
            setSelectedArticleId={() => {}}
            sortPreference={sortPreference}
            setSortPreference={() => {}}
            onOpenArticle={() => {}}
            detailOpen={false}
            onBack={() => {}}
            detailContent={<Box />}
            columns={["time", "source", "title", "tickers"]}
            emptyStateTitle="No stories"
          />
        </PaneInstanceProvider>
      </AppContext>,
      { width: 90, height: 10 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("NFLX");
    expect(frame).toContain("PARA");
    expect(frame).not.toContain("NFLX:XNAS");
    expect(frame).not.toContain("PARA:XNAS");
  });

  test("title-cases stored categories at display without changing ingest values", async () => {
    expect(formatNewsCategoryLabel("tech")).toBe("Tech");
    expect(formatNewsCategoryLabel("information_technology")).toBe("Information Technology");

    const state = createInitialState(
      createDefaultConfig("/tmp/gloomberb-news-table-category-test"),
    );

    testSetup = await testRender(
      <AppContext value={{ state, dispatch: () => {} }}>
        <PaneInstanceProvider paneId="news-feed:main">
          <NewsArticleStackView
            articles={[
              makeArticle({
                id: "chips",
                title: "Chip stocks rally",
                categories: ["tech"],
              }),
            ]}
            focused
            width={90}
            rootHeight={10}
            selectedArticleId="chips"
            setSelectedArticleId={() => {}}
            sortPreference={sortPreference}
            setSortPreference={() => {}}
            onOpenArticle={() => {}}
            detailOpen={false}
            onBack={() => {}}
            detailContent={<Box />}
            columns={["time", "title", "categories"]}
            emptyStateTitle="No stories"
          />
        </PaneInstanceProvider>
      </AppContext>,
      { width: 90, height: 10 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Tech");
    expect(frame).not.toMatch(/\btech\b/);
  });
});
