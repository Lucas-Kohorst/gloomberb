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
import { colors } from "../../../../../theme/colors";
import { createDefaultConfig } from "../../../../../types/config";
import { formatNewsCategoryLabel } from "../../../../../news/news-model";
import type { MarketNewsItem } from "../../../../../types/news-source";
import {
  buildNewsArticleRowRevision,
  NEWS_TABLE_MAX_ROWS,
  NewsArticleStackView,
  newsTableStatusContent,
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
          selectedArticleId="read"
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

function rgba(hex: string): string {
  const value = hex.slice(1);
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16)).concat(255).join(",");
}

describe("NewsArticleStackView", () => {
  test("renders unopened stories bold and opened stories muted", async () => {
    testSetup = await testRender(<Harness />, { width: 90, height: 10 });

    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const spans = testSetup.captureSpans().lines.flatMap((line) => line.spans);
    const unreadSpan = spans.find((span) => span.text.includes("Unread story"));
    const readSpan = spans.find((span) => span.text.includes("Read story"));

    expect((unreadSpan?.attributes ?? 0) & TextAttributes.BOLD).toBe(TextAttributes.BOLD);
    expect(unreadSpan?.fg.toInts().join(",")).toBe(rgba(colors.text));
    expect((readSpan?.attributes ?? 0) & TextAttributes.BOLD).toBe(0);
    expect(readSpan?.fg.toInts().join(",")).toBe(rgba(colors.textMuted));
  });

  test("uses the shared ticker empty and error states", async () => {
    const state = createInitialState(
      createDefaultConfig("/tmp/gloomberb-news-status-test"),
    );
    testSetup = await testRender(
      <AppContext value={{ state, dispatch: () => {} }}>
        {newsTableStatusContent({
          loading: false,
          error: null,
          subject: "News",
          ticker: "HDD",
          emptyTitle: "Legacy custom title",
          emptyMessage: "Legacy custom message",
        })}
      </AppContext>,
      { width: 80, height: 10 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
    });

    const emptyFrame = testSetup.captureCharFrame();
    expect(emptyFrame).toContain("No news data");
    expect(emptyFrame).toContain("HDD has no news.");
    expect(emptyFrame).not.toContain("Legacy custom title");
  });

  test("uses the shared ticker error state", async () => {
    const state = createInitialState(
      createDefaultConfig("/tmp/gloomberb-news-error-status-test"),
    );
    testSetup = await testRender(
      <AppContext value={{ state, dispatch: () => {} }}>
        {newsTableStatusContent({
          loading: false,
          error: "UPSTREAM_ERROR",
          subject: "News",
          ticker: "HDD",
          emptyTitle: "Legacy custom title",
        })}
      </AppContext>,
      { width: 80, height: 10 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
    });
    const errorFrame = testSetup.captureCharFrame();
    expect(errorFrame).toContain("News data unavailable");
    expect(errorFrame).toContain("The data source is unavailable.");
  });

  test("keeps the last column and human labels inside the pane width", async () => {
    const state = createInitialState(
      createDefaultConfig("/tmp/gloomberb-news-table-layout-test"),
    );

    testSetup = await testRender(
      <AppContext value={{ state, dispatch: () => {} }}>
        <PaneInstanceProvider paneId="news-top:main">
          <NewsArticleStackView
            articles={[
              makeArticle({
                id: "macro",
                title: "Fed officials signal caution on further rate cuts as inflation stays sticky",
                source: "globenewswire-releases",
                categories: ["macro_politics"],
                importance: 87,
              }),
            ]}
            focused
            width={90}
            rootHeight={10}
            selectedArticleId="macro"
            setSelectedArticleId={() => {}}
            sortPreference={{ columnId: "importance", direction: "desc" }}
            setSortPreference={() => {}}
            onOpenArticle={() => {}}
            detailOpen={false}
            onBack={() => {}}
            detailContent={<Box />}
            columns={["time", "source", "title", "tickers", "categories", "importance"]}
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

    const lines = testSetup.captureCharFrame().split("\n");
    // The sorted column and its indicator must survive the layout arithmetic.
    expect(lines[0]).toContain("SCORE");
    expect(lines[0]).toContain("\u25bc");
    expect(lines[0]!.length).toBeLessThanOrEqual(90);
    expect(lines[1]).toContain("87");
    // Snake_case ids and mid-word clipping never reach the user.
    expect(lines[1]).toContain("Politics");
    expect(lines[1]).not.toContain("macro_politics");
    expect(lines[1]).toContain("globenews...");
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

  test("paints ORIGIN for the firehose origin column instead of undefined", async () => {
    const state = createInitialState(
      createDefaultConfig("/tmp/gloomberb-news-table-origin-test"),
    );

    testSetup = await testRender(
      <AppContext value={{ state, dispatch: () => {} }}>
        <PaneInstanceProvider paneId="news-firehose:main">
          <NewsArticleStackView
            articles={[
              makeArticle({
                id: "wire",
                title: "Treasury yields jump after payrolls",
                origin: "gloomberb-cloud",
              }),
            ]}
            focused
            width={90}
            rootHeight={10}
            selectedArticleId="wire"
            setSelectedArticleId={() => {}}
            sortPreference={sortPreference}
            setSortPreference={() => {}}
            onOpenArticle={() => {}}
            detailOpen={false}
            onBack={() => {}}
            detailContent={<Box />}
            columns={["time", "origin", "source", "title", "tickers", "categories"]}
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
    const header = frame.split("\n")[0] ?? "";
    expect(header).toContain("ORIGIN");
    expect(header).not.toMatch(/\bundefined\b/);
    expect(frame).toContain("Treasury yields");
    expect(frame).toContain("Wire");
  });
});
