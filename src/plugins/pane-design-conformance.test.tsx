/**
 * Programmatic enforcement for the pane-design rules in AGENTS.md.
 *
 * Every builtin pane is rendered hermetically (no network) and run through
 * the OpenTUI gates. A new pane in the catalog is gated automatically; there
 * is no exemption list.
 */
import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { createElement } from "react";
import { uiBuiltinPlugins } from "./catalog-ui";
import { setCloudApiFetchTransport } from "../api-client";
import { setHttpFetchTransport } from "../utils/http-transport";
import {
  EMPTY_FOOTER,
  PANE_FOOTER_INFO_MAX_CHARS,
} from "../components/layout/pane/footer/model";
import {
  assertEmptyStateHasNextAction,
  assertFooterHasBoundActionHints,
  assertFooterHasNoResultCounts,
  assertFooterHintsBound,
  assertFooterHintKeysBindable,
  assertFooterInfoFitsChrome,
  assertFooterInfoIsStatusOnly,
  assertHasSearchFooterHint,
  assertNoBannedBullets,
  assertNoBodySearchSpinner,
  assertNoChipFilterChrome,
  assertNoDuplicateFooterHintKeys,
  assertNoGenericDataErrorDump,
  assertNoNavigationFooterHints,
  assertNoPerPaneRefreshHint,
  assertFooterHintKeyPrefixesAction,
  assertUniversalPaneDesignGates,
  renderAuditedPane,
  settleFrames,
  sourceHasBoundTableFooterHints,
  sourceHasClickableHeaderSort,
  NEWS_IN_PANE_SEARCH_PANE_IDS,
  type AuditedPaneRender,
} from "../test-support/pane-design";
import { MemoryPluginPersistence } from "../test-support/plugin-persistence";
import {
  attachEconCalendarPersistence,
  resetEconCalendarPersistence,
} from "./builtin/econ/calendar-model";
import { ETF_FORMS_SETTING } from "./builtin/sec/forms";
import { secModule } from "./builtin/sec";
import { TranscriptView } from "./builtin/earnings-calls/transcript-view";
import type {
  CloudEarningsTranscriptPayload,
  CloudTranscriptTurnPayload,
} from "../api-client";
import { PluginMarketplacePane } from "./builtin/plugin-marketplace/pane";
import { resetRegistryFeedCacheForTests } from "./builtin/plugin-marketplace/feed";
import { summarizeSearchFailures } from "./builtin/research-search/data";
import { ResearchSearchPane } from "./builtin/research-search/pane";
import { setSharedRegistryForTests } from "./registry/shared";
import type { DocumentSearchProvider } from "../types/plugin";

function builtinPaneEntries() {
  return uiBuiltinPlugins.flatMap((plugin) =>
    (plugin.panes ?? []).map((pane) => ({ pluginId: plugin.id, pane })),
  );
}

describe("pane design conformance", () => {
  test("every pane template stays AI-visible", () => {
    const templates = uiBuiltinPlugins.flatMap((plugin) => plugin.paneTemplates ?? []);
    expect(templates.length).toBeGreaterThan(0);
    for (const template of templates) {
      expect(
        template.description.trim().length > 0,
        `${template.id}: pane template needs a description for the assist inventory`,
      ).toBe(true);
      const hasPrefix = (template.shortcut?.prefix ?? "").trim().length > 0;
      expect(
        hasPrefix || typeof template.canCreate === "function",
        `${template.id}: pane template needs a command-bar shortcut prefix`,
      ).toBe(true);
    }
  });

  test("gates every builtin pane in the catalog", () => {
    const entries = builtinPaneEntries();
    expect(entries.length).toBeGreaterThan(0);
    const ids = entries.map((entry) => entry.pane.id);
    expect(new Set(ids).size, `duplicate pane ids: ${ids.join(", ")}`).toBe(ids.length);
  });

  describe("all builtin panes (universal gates)", () => {
    const entries = builtinPaneEntries();

    let rendered: AuditedPaneRender | undefined;
    afterEach(async () => {
      await rendered?.destroy();
      rendered = undefined;
      setHttpFetchTransport(null);
      setCloudApiFetchTransport(null as never);
      resetRegistryFeedCacheForTests();
    });

    for (const { pluginId, pane } of entries) {
      test(`${pane.id}: no banned bullets, footer hints bound, no result tallies`, async () => {
        resetRegistryFeedCacheForTests();
        // Hermetic: panes render their empty/error states, never the network.
        setHttpFetchTransport(async () => {
          throw new Error("design-gate: no network");
        });
        setCloudApiFetchTransport(async () => {
          throw new Error("design-gate: no network");
        });
        rendered = await renderAuditedPane({
          paneId: pane.id,
          pluginId,
          node: createElement(pane.component, {
            paneId: `${pane.id}:design`,
            paneType: pane.id,
            focused: true,
            width: 100,
            height: 30,
          }),
        });
        // Let rejected fetches settle inside act so error states render.
        await settleFrames(rendered, 3);
        assertUniversalPaneDesignGates(rendered.frame, rendered.footer, pane.id, pane.name);
      });
    }
  });

  describe("gate self-tests", () => {
    test("bullet scan fires on banned glyphs", () => {
      expect(() => assertNoBannedBullets("TICKER  • 2h", "probe")).toThrow();
      expect(() => assertNoBannedBullets("AGE  ● 14:32", "probe")).toThrow();
      expect(() => assertNoBannedBullets("FILED  · Apr 18", "probe")).toThrow();
      // Metadata separators are fine.
      expect(() => assertNoBannedBullets("CFTC · filings · sorted", "probe")).not.toThrow();
    });

    test("footer gates fire on unbound hints and result tallies", () => {
      expect(() => assertFooterHintsBound(
        { ...EMPTY_FOOTER, hints: [{ id: "refresh", key: "r", label: "efresh" }] },
        "probe",
      )).toThrow();
      expect(() => assertFooterHasNoResultCounts(
        {
          ...EMPTY_FOOTER,
          info: [{ id: "counts", parts: [{ text: "42 results" }] }],
        },
        "probe",
      )).toThrow();
      expect(() => assertFooterHintKeysBindable(
        {
          ...EMPTY_FOOTER,
          hints: [{ id: "save", key: "Ctrl+S", label: "save search", onPress: () => {} }],
        },
        "probe",
      )).toThrow();
      expect(() => assertFooterHintKeysBindable(
        {
          ...EMPTY_FOOTER,
          hints: [{ id: "cancel", key: "Esc", label: "cancel", onPress: () => {} }],
        },
        "probe",
      )).toThrow();
      expect(() => assertNoNavigationFooterHints(
        {
          ...EMPTY_FOOTER,
          hints: [{ id: "cancel", key: "Esc", label: "cancel", onPress: () => {} }],
        },
        "probe",
      )).toThrow();
      expect(() => assertNoDuplicateFooterHintKeys(
        {
          ...EMPTY_FOOTER,
          hints: [
            { id: "save", key: "s", label: "ave", onPress: () => {} },
            { id: "search", key: "s", label: "earch", onPress: () => {} },
          ],
        },
        "probe",
      )).toThrow();
      expect(() => assertNoPerPaneRefreshHint(
        {
          ...EMPTY_FOOTER,
          hints: [{ id: "refresh", key: "r", label: "efresh", onPress: () => {} }],
        },
        "probe",
      )).toThrow();
      expect(() => assertFooterInfoFitsChrome(
        {
          ...EMPTY_FOOTER,
          info: [{ id: "error", parts: [{ text: "this error message is way too long for a chip" }] }],
        },
        "probe",
      )).toThrow();
      expect(() => assertFooterInfoFitsChrome(
        {
          ...EMPTY_FOOTER,
          info: [{ id: "error", parts: [{ text: '{"stack":true}' }] }],
        },
        "probe",
      )).toThrow();
      expect(() => assertNoChipFilterChrome("Type All  Range: 7D  Source All", "probe")).toThrow();
      expect(() => assertNoBodySearchSpinner("* Searching...", "probe")).toThrow();
      expect(() => assertFooterHintKeyPrefixesAction(
        {
          ...EMPTY_FOOTER,
          hints: [{ id: "share", key: "y", label: "share", onPress: () => {} }],
        },
        "probe",
      )).toThrow();
      expect(() => assertFooterHintKeyPrefixesAction(
        {
          ...EMPTY_FOOTER,
          hints: [{ id: "share", key: "s", label: "hare", onPress: () => {} }],
        },
        "probe",
      )).not.toThrow();
      expect(() => assertNoGenericDataErrorDump(
        "SEC data unavailable\nThe data source is unavailable.",
        "sec",
      )).toThrow();
      expect(() => assertNoGenericDataErrorDump(
        "No recent fund filings.\nType a ticker or fund name.",
        "sec",
      )).not.toThrow();
      expect(() => assertFooterHasBoundActionHints(EMPTY_FOOTER, "probe")).toThrow();
      expect(() => assertHasSearchFooterHint(
        { ...EMPTY_FOOTER, hints: [{ id: "filter", key: "f", label: "ilter", onPress: () => {} }] },
        "probe",
      )).toThrow();
      expect(sourceHasClickableHeaderSort("<DataTableView onHeaderClick={handleHeaderClick} />")).toBe(true);
      expect(sourceHasClickableHeaderSort("<DataTableStackView onHeaderClick={() => {}} />")).toBe(false);
      expect(sourceHasClickableHeaderSort("<FeedDataTableStackView items={items} />")).toBe(true);
      expect(sourceHasClickableHeaderSort("<DataTableView items={rows} />")).toBe(false);
      expect(sourceHasClickableHeaderSort(
        "<DataTableView onHeaderClick={() => {}} sortColumnId={null} />",
      )).toBe(true);
      expect(sourceHasBoundTableFooterHints("paneSearchHint(focusSearch)")).toBe(true);
      expect(sourceHasBoundTableFooterHints("hints: [{ id: \"open\", onPress: open }]")).toBe(false);
    });
  });

  describe("transcript loaded state", () => {
    const turns: CloudTranscriptTurnPayload[] = [
      {
        speaker: "Operator",
        text: "Good morning and welcome to the call. Please note this call may contain forward-looking statements.",
        isQa: false,
        startSeconds: 0,
      },
      {
        speaker: "Tim Cook",
        role: "CEO",
        company: "Apple",
        text: "Revenue grew twenty percent year over year on strong demand.",
        isQa: false,
        startSeconds: 61,
      },
    ];
    const transcript: CloudEarningsTranscriptPayload = {
      id: "call-1",
      ticker: "AAPL",
      companyName: "Apple",
      fiscalYear: 2026,
      fiscalQuarter: 2,
      callAt: "2026-05-02T21:00:00.000Z",
      timing: null,
      webcastUrl: null,
      durationSeconds: 3600,
      status: "ready",
      fullText: "",
      turns,
      participants: [],
      summary: "Revenue grew. Margins expanded.",
      guidance: null,
      riskFactors: null,
      analystFocus: null,
      notable: null,
      sentiment: null,
      sentimentRationale: null,
    };

    let rendered: AuditedPaneRender | undefined;
    afterEach(async () => {
      await rendered?.destroy();
      rendered = undefined;
    });

    for (const tab of ["summary", "transcript"] as const) {
      test(`${tab} tab has no banned bullets`, async () => {
        rendered = await renderAuditedPane({
          paneId: `transcript-${tab}`,
          pluginId: "earnings-calls",
          node: (
            <TranscriptView
              transcript={transcript}
              loading={false}
              error={null}
              tab={tab}
              onTabChange={() => {}}
              tabsFocused={false}
              width={100}
            />
          ),
        });
        assertNoBannedBullets(rendered.frame, `transcript-${tab}`);
      });
    }
  });

  describe("research search", () => {
    const CFTC_HIT_URL = "https://www.cftc.gov/filings/742";
    const cftcHit = {
      id: "742",
      title: "Kalshi contract certification",
      source: "CFTC",
      documentType: "Filing",
      snippet: "CFTC product certification",
      publishedAt: "2026-08-21T12:00:00.000Z",
      url: CFTC_HIT_URL,
    };
    const cftcProvider: DocumentSearchProvider = {
      id: "adjacent:cftc-filings",
      name: "CFTC filings",
      documentTypes: ["filing"],
      async search() {
        return [cftcHit];
      },
      async load(id) {
        return {
          id,
          title: "Kalshi contract certification",
          markdown: "Certified product filing.",
          sourceUrl: CFTC_HIT_URL,
        };
      },
    };

    function installHermeticNetwork(cloudBody?: unknown) {
      setHttpFetchTransport(async () => {
        throw new Error("design-gate: no network");
      });
      setCloudApiFetchTransport(async () => {
        if (cloudBody !== undefined) {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            text: async () => JSON.stringify(cloudBody),
          } as Response;
        }
        throw new Error("design-gate: no network");
      });
    }

    function researchSearchNode() {
      return (
        <ResearchSearchPane
          paneId="research-search:design"
          paneType="research-search"
          focused
          width={100}
          height={30}
        />
      );
    }

    let rendered: AuditedPaneRender | undefined;
    afterEach(async () => {
      await rendered?.destroy();
      rendered = undefined;
      setSharedRegistryForTests(undefined);
      setHttpFetchTransport(null);
      setCloudApiFetchTransport(null as never);
    });

    test("empty chrome is SelectButton labels, not filter chips", async () => {
      setHttpFetchTransport(async () => {
        throw new Error("design-gate: no network");
      });
      setCloudApiFetchTransport(async () => {
        throw new Error("design-gate: no network");
      });
      rendered = await renderAuditedPane({
        paneId: "research-search",
        pluginId: "research-search",
        node: (
          <ResearchSearchPane
            paneId="research-search:design"
            paneType="research-search"
            focused
            width={100}
            height={30}
          />
        ),
      });
      await settleFrames(rendered, 3);
      expect(rendered.frame).toContain("Type");
      expect(rendered.frame).toContain("Range");
      expect(rendered.frame).not.toContain("Types:");
      expect(rendered.frame).not.toContain("Sources:");
      expect(rendered.frame).not.toContain("Relevance");
      expect(rendered.frame).not.toContain("7D");
      assertEmptyStateHasNextAction(rendered.frame, "research-search", "Type a query");
      assertFooterHintKeysBindable(rendered.footer, "research-search");
      assertFooterHintsBound(rendered.footer, "research-search");
      assertNoBannedBullets(rendered.frame, "research-search");
    });

    test("CFTC document hits fill the table and save is a bindable footer key", async () => {
      setSharedRegistryForTests({
        getAvailableDocumentSearchProviders: () => [cftcProvider],
        documentSearchProviders: new Map([[cftcProvider.id, cftcProvider]]),
      } as never);
      installHermeticNetwork();
      rendered = await renderAuditedPane({
        paneId: "research-search",
        pluginId: "research-search",
        settings: { query: "kalshi" },
        node: researchSearchNode(),
      });
      await settleFrames(rendered, 8);
      expect(rendered.frame).toContain("Kalshi contract certification");
      expect(rendered.frame).toContain("CFTC");
      expect(rendered.frame).toContain("MATCH");
      expect(rendered.frame).toContain("DATE");
      expect(rendered.frame).not.toContain("Searching...");
      const save = rendered.footer.hints.find((hint) => hint.id === "save");
      expect(save?.key).toBe("s");
      const search = rendered.footer.hints.find((hint) => hint.id === "search");
      expect(search?.key).toBe("/");
      assertFooterHintKeysBindable(rendered.footer, "research-search");
      assertFooterHintsBound(rendered.footer, "research-search");
      assertFooterInfoIsStatusOnly(rendered.footer, "research-search");
      assertNoBannedBullets(rendered.frame, "research-search");
      assertNoChipFilterChrome(rendered.frame, "research-search");
      assertNoBodySearchSpinner(rendered.frame, "research-search");
      assertNoPerPaneRefreshHint(rendered.footer, "research-search");
    });

    test("named source error chip when a provider fails beside CFTC hits", async () => {
      const otherProvider: DocumentSearchProvider = {
        id: "fixture:other-source",
        name: "Other source",
        documentTypes: ["news"],
        async search() {
          throw new Error("boom");
        },
        async load() {
          throw new Error("boom");
        },
      };
      setSharedRegistryForTests({
        getAvailableDocumentSearchProviders: () => [cftcProvider, otherProvider],
        documentSearchProviders: new Map([
          [cftcProvider.id, cftcProvider],
          [otherProvider.id, otherProvider],
        ]),
      } as never);
      installHermeticNetwork({ hits: [], hasMore: false, nextOffset: 0 });
      rendered = await renderAuditedPane({
        paneId: "research-search",
        pluginId: "research-search",
        settings: { query: "kalshi" },
        node: researchSearchNode(),
      });
      await settleFrames(rendered, 8);
      expect(rendered.frame).toContain("Kalshi contract certification");
      assertNoBodySearchSpinner(rendered.frame, "research-search");
      const expected = summarizeSearchFailures(
        [
          { status: "fulfilled", value: { hits: [] } },
          { status: "fulfilled", value: [cftcHit] },
          { status: "rejected", reason: new Error("boom") },
        ],
        ["Gloom Cloud", cftcProvider.name, otherProvider.name],
      );
      const chips = rendered.footer.info.flatMap((segment) => (
        segment.parts.map((part) => part.text)
      ));
      expect(expected?.label).toBe("Other source error");
      expect(chips).toContain(expected!.label);
      expect(chips).not.toContain("source error");
      expect(expected!.label.length).toBeLessThanOrEqual(PANE_FOOTER_INFO_MAX_CHARS);
      assertUniversalPaneDesignGates(
        rendered.frame,
        rendered.footer,
        "research-search",
        "Research Search",
      );
    });

    test("[o]pen is hinted after activating a CFTC hit that has a URL", async () => {
      setSharedRegistryForTests({
        getAvailableDocumentSearchProviders: () => [cftcProvider],
        documentSearchProviders: new Map([[cftcProvider.id, cftcProvider]]),
      } as never);
      installHermeticNetwork();
      rendered = await renderAuditedPane({
        paneId: "research-search",
        pluginId: "research-search",
        settings: { query: "kalshi" },
        node: researchSearchNode(),
      });
      await settleFrames(rendered, 8);
      expect(rendered.frame).toContain("Kalshi contract certification");

      await rendered.emitKeypress({ name: "return", sequence: "\r" });
      await settleFrames(rendered, 8);
      const open = rendered.footer.hints.find((hint) => hint.id === "open");
      expect(open?.key).toBe("o");
    });
  });

  describe("plugin marketplace loading", () => {
    let rendered: AuditedPaneRender | undefined;
    afterEach(async () => {
      await rendered?.destroy();
      rendered = undefined;
      setHttpFetchTransport(null);
      resetRegistryFeedCacheForTests();
    });

    test("holds loading until the catalog resolves", async () => {
      resetRegistryFeedCacheForTests();
      const response = Promise.withResolvers<Response>();
      setHttpFetchTransport(() => response.promise);
      rendered = await renderAuditedPane({
        paneId: "plugin-marketplace",
        pluginId: "plugin-marketplace",
        node: (
          <PluginMarketplacePane
            paneId="plugin-marketplace:design"
            paneType="plugin-marketplace"
            focused
            width={100}
            height={30}
          />
        ),
      });
      expect(rendered.frame).toContain("Loading plugin catalog");
      expect(rendered.frame).not.toContain("Installed");
      expect(rendered.frame).not.toContain("Discover");
      response.resolve(Response.json({ plugins: [] }));
      await settleFrames(rendered);
      expect(rendered.frame).not.toContain("Loading plugin catalog");
    });

    test("loaded catalog binds footer hints and keeps time cells clean", async () => {
      resetRegistryFeedCacheForTests();
      setHttpFetchTransport(async () =>
        Response.json({
          plugins: [
            {
              id: "fixture-one",
              name: "Fixture One",
              tagline: "First fixture plugin",
              description: "First fixture plugin for design conformance.",
              repo: "example/fixture-one",
              author: { name: "Fixture" },
              categories: ["data"],
              targets: ["tui", "desktop"],
              hosts: [],
              contributes: { panes: [], capabilities: [], broker: false },
              tier: "community",
              bundled: false,
              stars: 12,
            },
            {
              id: "fixture-two",
              name: "Fixture Two",
              tagline: "Second fixture plugin",
              description: "Second fixture plugin for design conformance.",
              repo: "example/fixture-two",
              author: { name: "Fixture" },
              categories: ["data"],
              targets: ["tui", "desktop"],
              hosts: [],
              contributes: { panes: [], capabilities: [], broker: false },
              tier: "community",
              bundled: false,
              stars: 3,
            },
          ],
        }),
      );
      rendered = await renderAuditedPane({
        paneId: "plugin-marketplace",
        pluginId: "plugin-marketplace",
        node: (
          <PluginMarketplacePane
            paneId="plugin-marketplace:design"
            paneType="plugin-marketplace"
            focused
            width={100}
            height={30}
          />
        ),
        frames: 12,
      });
      // Flush the async registry fetch through the pane's refresh cycle.
      await settleFrames(rendered, 8);
      expect(rendered.frame).toContain("Fixture One");
      expect(rendered.frame).toContain("Fixture Two");
      expect(rendered.frame).not.toContain("Loading plugin catalog");
      assertNoBannedBullets(rendered.frame, "plugin-marketplace");
      assertFooterHintsBound(rendered.footer, "plugin-marketplace");
      assertFooterHasNoResultCounts(rendered.footer, "plugin-marketplace");
    });
  });

  describe("news list search", () => {
    const newsSearchEntries = builtinPaneEntries().filter(({ pane }) => (
      (NEWS_IN_PANE_SEARCH_PANE_IDS as readonly string[]).includes(pane.id)
    ));

    let rendered: AuditedPaneRender | undefined;
    afterEach(async () => {
      await rendered?.destroy();
      rendered = undefined;
      setHttpFetchTransport(null);
      setCloudApiFetchTransport(null as never);
    });

    test("catalog still ships the news lists that need in-pane search", () => {
      expect(newsSearchEntries.map(({ pane }) => pane.id).sort()).toEqual(
        [...NEWS_IN_PANE_SEARCH_PANE_IDS].sort(),
      );
    });

    for (const { pluginId, pane } of newsSearchEntries) {
      test(`${pane.id}: bound footer hints include search`, async () => {
        setHttpFetchTransport(async () => {
          throw new Error("design-gate: no network");
        });
        setCloudApiFetchTransport(async () => {
          throw new Error("design-gate: no network");
        });
        rendered = await renderAuditedPane({
          paneId: pane.id,
          pluginId,
          node: createElement(pane.component, {
            paneId: `${pane.id}:design`,
            paneType: pane.id,
            focused: true,
            width: 100,
            height: 30,
          }),
        });
        await settleFrames(rendered, 3);
        assertFooterHasBoundActionHints(rendered.footer, pane.id);
        assertHasSearchFooterHint(rendered.footer, pane.id);
        assertNoPerPaneRefreshHint(rendered.footer, pane.id);
        assertUniversalPaneDesignGates(rendered.frame, rendered.footer, pane.id, pane.name);
      });
    }
  });

  describe("calendar tables", () => {
    const calendarEntries = builtinPaneEntries().filter(({ pane }) => (
      pane.id.toLowerCase().includes("calendar")
      || pane.name.toLowerCase().includes("calendar")
    ));

    let rendered: AuditedPaneRender | undefined;
    afterEach(async () => {
      await rendered?.destroy();
      rendered = undefined;
      setHttpFetchTransport(null);
      setCloudApiFetchTransport(null as never);
      resetEconCalendarPersistence();
      setSystemTime();
    });

    for (const { pluginId, pane } of calendarEntries) {
      test(`${pane.id}: bound footer hints include search`, async () => {
        setHttpFetchTransport(async () => {
          throw new Error("design-gate: no network");
        });
        setCloudApiFetchTransport(async () => {
          throw new Error("design-gate: no network");
        });
        rendered = await renderAuditedPane({
          paneId: pane.id,
          pluginId,
          node: createElement(pane.component, {
            paneId: `${pane.id}:design`,
            paneType: pane.id,
            focused: true,
            width: 100,
            height: 30,
          }),
        });
        await settleFrames(rendered, 3);
        assertFooterHasBoundActionHints(rendered.footer, pane.id);
        assertHasSearchFooterHint(rendered.footer, pane.id);
        assertUniversalPaneDesignGates(rendered.frame, rendered.footer, pane.id, pane.name);
      });
    }

    test("econ-calendar error copy is specific and searchable", async () => {
      setHttpFetchTransport(async () => {
        throw new Error("design-gate: no network");
      });
      setCloudApiFetchTransport(async () => {
        throw new Error("design-gate: no network");
      });
      const econ = calendarEntries.find(({ pane }) => pane.id === "econ-calendar");
      if (!econ) throw new Error("econ-calendar pane missing");
      rendered = await renderAuditedPane({
        paneId: econ.pane.id,
        pluginId: econ.pluginId,
        node: createElement(econ.pane.component, {
          paneId: "econ-calendar:design",
          paneType: "econ-calendar",
          focused: true,
          width: 100,
          height: 30,
        }),
      });
      await settleFrames(rendered, 6);
      expect(rendered.frame).toContain("Economic calendar unavailable.");
      expect(rendered.frame).not.toContain("data unavailable");
      expect(rendered.frame).not.toContain("No events");
      assertEmptyStateHasNextAction(rendered.frame, "econ-calendar", "Press r to retry.");
      assertHasSearchFooterHint(rendered.footer, "econ-calendar");
      assertFooterHasBoundActionHints(rendered.footer, "econ-calendar");
    });

    test("econ-calendar mapped event hints [o]pen and keeps header sort", async () => {
      setSystemTime(new Date("2026-08-21T12:00:00.000Z"));
      const persistence = new MemoryPluginPersistence();
      const now = Date.now();
      persistence.seedResource("calendar", "global", [
        {
          id: "cpi",
          date: new Date(now + 3_600_000).toISOString(),
          time: "08:30",
          country: "US",
          event: "CPI m/m",
          impact: "high",
          actual: null,
          forecast: "0.3%",
          prior: "0.2%",
        },
      ], { sourceKey: "gloomberb-cloud", schemaVersion: 1 });
      attachEconCalendarPersistence(persistence);
      setHttpFetchTransport(async () => {
        throw new Error("design-gate: no network");
      });
      setCloudApiFetchTransport(async () => {
        throw new Error("design-gate: no network");
      });
      const econ = calendarEntries.find(({ pane }) => pane.id === "econ-calendar");
      if (!econ) throw new Error("econ-calendar pane missing");
      rendered = await renderAuditedPane({
        paneId: econ.pane.id,
        pluginId: econ.pluginId,
        width: 110,
        height: 30,
        node: createElement(econ.pane.component, {
          paneId: "econ-calendar:design",
          paneType: "econ-calendar",
          focused: true,
          width: 110,
          height: 30,
        }),
      });
      await settleFrames(rendered, 6);
      expect(rendered.frame).toContain("CPI m/m");
      expect(rendered.frame).toContain("TIME");
      expect(rendered.frame).toContain("PRIOR");
      const open = rendered.footer.hints.find((hint) => hint.id === "open");
      expect(open?.key).toBe("o");
      expect(open?.onPress).toBeTypeOf("function");
      assertHasSearchFooterHint(rendered.footer, "econ-calendar");
      assertFooterHasBoundActionHints(rendered.footer, "econ-calendar");
      assertUniversalPaneDesignGates(rendered.frame, rendered.footer, "econ-calendar", "Economic Calendar");
    });
  });

  describe("SEC / ETF filings empty vs error", () => {
    const secPane = secModule.panes?.find((pane) => pane.id === "sec");
    if (!secPane) throw new Error("sec pane missing");

    let rendered: AuditedPaneRender | undefined;
    afterEach(async () => {
      await rendered?.destroy();
      rendered = undefined;
      setHttpFetchTransport(null);
      setCloudApiFetchTransport(null as never);
    });

    function secNode() {
      return createElement(secPane.component, {
        paneId: "sec:design",
        paneType: "sec",
        focused: true,
        width: 100,
        height: 30,
      });
    }

    test("transport failure names EDGAR, not a generic dump", async () => {
      setHttpFetchTransport(async () => {
        throw new Error("design-gate: no network");
      });
      rendered = await renderAuditedPane({
        paneId: "sec",
        pluginId: "ticker-research",
        node: secNode(),
      });
      await settleFrames(rendered, 8);
      expect(rendered.frame).toContain("SEC EDGAR unavailable.");
      expect(rendered.frame).not.toContain("The data source is unavailable.");
      expect(rendered.frame).not.toContain("SEC data unavailable");
      assertNoGenericDataErrorDump(rendered.frame, "sec");
      assertEmptyStateHasNextAction(rendered.frame, "sec", "Press r to retry.");
      const chips = rendered.footer.info.flatMap((segment) => (
        segment.parts.map((part) => part.text)
      ));
      expect(chips).toContain("unavailable");
      assertFooterHintsBound(rendered.footer, "sec");
    });

    test("ETF latest empty names fund forms and the next action", async () => {
      setHttpFetchTransport(async () => (
        new Response(JSON.stringify({ hits: { hits: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      ));
      rendered = await renderAuditedPane({
        paneId: "sec",
        pluginId: "ticker-research",
        settings: { forms: ETF_FORMS_SETTING },
        node: secNode(),
      });
      await settleFrames(rendered, 8);
      expect(rendered.frame).toContain("No recent fund filings.");
      expect(rendered.frame).toContain("N-1A");
      expect(rendered.frame).toContain("485BPOS");
      assertEmptyStateHasNextAction(rendered.frame, "sec", "Type a ticker or fund name");
      assertNoGenericDataErrorDump(rendered.frame, "sec");
      const chips = rendered.footer.info.flatMap((segment) => (
        segment.parts.map((part) => part.text)
      ));
      expect(chips).not.toContain("unavailable");
    });

    test("search with no hits names the query", async () => {
      setHttpFetchTransport(async (url) => {
        if (String(url).includes("company_tickers_exchange.json")) {
          return new Response(JSON.stringify({
            fields: ["cik", "name", "ticker", "exchange"],
            data: [],
          }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({ hits: { hits: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });
      rendered = await renderAuditedPane({
        paneId: "sec",
        pluginId: "ticker-research",
        settings: { query: "ZZZZ", forms: ETF_FORMS_SETTING },
        node: secNode(),
      });
      await new Promise((resolve) => setTimeout(resolve, 350));
      await settleFrames(rendered, 8);
      expect(rendered.frame).toContain("No fund filings for ZZZZ.");
      expect(rendered.frame).not.toContain("The data source is unavailable.");
      assertNoGenericDataErrorDump(rendered.frame, "sec");
    });
  });
});
