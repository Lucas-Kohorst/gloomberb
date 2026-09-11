/**
 * Programmatic enforcement for the pane-design rules in AGENTS.md.
 *
 * Adding a builtin pane without adding it to AUDITED_PANES (or explicitly to
 * EXEMPT_PANES with a reason) fails the coverage gate below. That is the
 * point: future panes and plugins cannot silently skip design review.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { uiBuiltinPlugins } from "./catalog-ui";
import { setCloudApiFetchTransport } from "../api-client";
import { setHttpFetchTransport } from "../utils/http-transport";
import { EMPTY_FOOTER } from "../components/layout/pane/footer/model";
import {
  assertBodyDoesNotRepeatPaneName,
  assertFooterHasNoResultCounts,
  assertFooterHintsBound,
  assertFooterHintKeysBindable,
  assertFooterInfoIsStatusOnly,
  assertNoBannedBullets,
  renderAuditedPane,
  settleFrames,
  type AuditedPaneRender,
} from "../test-support/pane-design";
import { TranscriptView } from "./builtin/earnings-calls/transcript-view";
import type {
  CloudEarningsTranscriptPayload,
  CloudTranscriptTurnPayload,
} from "../api-client";
import { PluginMarketplacePane } from "./builtin/plugin-marketplace/pane";
import { resetRegistryFeedCacheForTests } from "./builtin/plugin-marketplace/feed";

function builtinPaneIds(): string[] {
  return uiBuiltinPlugins.flatMap((plugin) => (plugin.panes ?? []).map((pane) => pane.id));
}

/**
 * Panes with a render entry below. Each entry renders without network so the
 * suite stays hermetic.
 */
const AUDITED_PANES = new Set([
  "plugin-marketplace",
]);

/**
 * Panes without a render entry yet. Every exemption needs a reason; moving a
 * pane from here to AUDITED_PANES is always welcome.
 */
const EXEMPT_PANES: Record<string, string> = {
  "trend-analysis": "universal gates pass; needs ticker fixture for deep entry",
  "momentum-sortino": "universal gates pass; needs ticker fixture for deep entry",
  "technical-summary": "universal gates pass; needs ticker fixture for deep entry",
  "pattern-recognition": "universal gates pass; needs ticker fixture for deep entry",
  "cash-flow": "universal gates pass; needs ticker fixture for deep entry",
  "assets-under-management": "universal gates pass; needs ticker fixture for deep entry",
  // Needs a data-provider fixture.
  "account-management": "universal gates pass; needs fixture for deep entry",
  "adjacent-indices": "universal gates pass; needs fixture for deep entry",
  "adjacent-rates": "universal gates pass; needs fixture for deep entry",
  "analyst-research": "universal gates pass; needs fixture for deep entry",
  "analytics": "universal gates pass; needs fixture for deep entry",
  "bond-search": "universal gates pass; needs fixture for deep entry",
  brokers: "universal gates pass; needs fixture for deep entry",
  buildout: "universal gates pass; needs fixture for deep entry",
  cds: "universal gates pass; needs fixture for deep entry",
  "cftc-filings": "universal gates pass; needs fixture for deep entry",
  changelog: "universal gates pass; needs fixture for deep entry",
  "chart-composer": "universal gates pass; needs fixture for deep entry",
  chat: "universal gates pass; needs fixture for deep entry",
  connections: "universal gates pass; needs fixture for deep entry",
  "corporate-actions": "universal gates pass; needs fixture for deep entry",
  correlation: "universal gates pass; needs fixture for deep entry",
  "credit-conditions": "universal gates pass; needs fixture for deep entry",
  "crt-sh": "universal gates pass; needs fixture for deep entry",
  "data-catalog": "universal gates pass; needs fixture for deep entry",
  "dividend-yield": "universal gates pass; needs fixture for deep entry",
  "earnings-calendar": "universal gates pass; needs fixture for deep entry",
  "earnings-calls": "universal gates pass; needs fixture for deep entry",
  "earnings-estimates": "universal gates pass; needs fixture for deep entry",
  "earnings-transcripts": "universal gates pass; needs fixture for deep entry",
  "econ-calendar": "universal gates pass; needs fixture for deep entry",
  "econ-statistics": "universal gates pass; needs fixture for deep entry",
  "equity-diagnostic": "universal gates pass; needs fixture for deep entry",
  esg: "universal gates pass; needs fixture for deep entry",
  "fear-greed": "universal gates pass; needs fixture for deep entry",
  "financial-analysis": "universal gates pass; needs fixture for deep entry",
  futures: "universal gates pass; needs fixture for deep entry",
  "fx-matrix": "universal gates pass; needs fixture for deep entry",
  help: "universal gates pass; needs fixture for deep entry",
  "historical-prices": "universal gates pass; needs fixture for deep entry",
  holders: "universal gates pass; needs fixture for deep entry",
  insider: "universal gates pass; needs fixture for deep entry",
  "ipo-calendar": "universal gates pass; needs fixture for deep entry",
  "kelly-sizer": "universal gates pass; needs fixture for deep entry",
  "layout-marketplace": "universal gates pass; needs fixture for deep entry",
  "llm-stats": "universal gates pass; needs fixture for deep entry",
  "macro-tv": "universal gates pass; needs fixture for deep entry",
  "market-halts": "universal gates pass; needs fixture for deep entry",
  "market-heatmap": "universal gates pass; needs fixture for deep entry",
  "market-movers": "universal gates pass; needs fixture for deep entry",
  "market-valuation": "universal gates pass; needs fixture for deep entry",
  "news-article": "universal gates pass; needs fixture for deep entry",
  "news-breaking": "universal gates pass; needs fixture for deep entry",
  "news-feed": "universal gates pass; needs fixture for deep entry",
  "news-firehose": "universal gates pass; needs fixture for deep entry",
  "news-industry": "universal gates pass; needs fixture for deep entry",
  "news-rss": "universal gates pass; needs fixture for deep entry",
  "news-top": "universal gates pass; needs fixture for deep entry",
  options: "universal gates pass; needs fixture for deep entry",
  "options-calc": "universal gates pass; needs fixture for deep entry",
  "options-calculator": "universal gates pass; needs fixture for deep entry",
  "options-vol-surface": "universal gates pass; needs fixture for deep entry",
  owid: "universal gates pass; needs fixture for deep entry",
  "plugin-inspector": "universal gates pass; needs fixture for deep entry",
  "portfolio-list": "universal gates pass; needs fixture for deep entry",
  "quote-monitor": "universal gates pass; needs fixture for deep entry",
  "relationship-graph": "universal gates pass; needs fixture for deep entry",
  "relative-valuation": "universal gates pass; needs fixture for deep entry",
  "research-search": "behavior covered in pane.test.tsx; needs cloud fixture for design entry",
  "scanner-flow": "universal gates pass; needs fixture for deep entry",
  "scanner-hilo": "universal gates pass; needs fixture for deep entry",
  sec: "universal gates pass; needs fixture for deep entry",
  sectors: "universal gates pass; needs fixture for deep entry",
  "short-interest": "universal gates pass; needs fixture for deep entry",
  "thirteenf-funds": "universal gates pass; needs fixture for deep entry",
  "ticker-news": "universal gates pass; needs fixture for deep entry",
  "ticker-research": "universal gates pass; needs fixture for deep entry",
  "treasury-auctions": "universal gates pass; needs fixture for deep entry",
  "unread-inbox": "universal gates pass; needs fixture for deep entry",
  "volatility-term-structure": "universal gates pass; needs fixture for deep entry",
  "world-indices": "universal gates pass; needs fixture for deep entry",
  "world-venue-map": "universal gates pass; needs fixture for deep entry",
  "yield-curve": "universal gates pass; needs fixture for deep entry",

  // Bear Cave batch (2026-09): built with the shared pane pattern; universal
  // gates run on the empty/error states. Deep entries wait on fixtures.
  "adverse-events": "universal gates pass; needs fixture for deep entry",
  "books": "universal gates pass; needs fixture for deep entry",
  "cboe-book": "universal gates pass; needs fixture for deep entry",
  "comment-letters": "universal gates pass; needs fixture for deep entry",
  "complaints": "universal gates pass; needs fixture for deep entry",
  "companies": "universal gates pass; needs fixture for deep entry",
  "courtlistener": "universal gates pass; needs fixture for deep entry",
  "earthquakes": "universal gates pass; needs fixture for deep entry",
  "energy": "universal gates pass; needs fixture for deep entry",
  "fdic-bank": "universal gates pass; needs fixture for deep entry",
  "filing-diff": "universal gates pass; needs fixture for deep entry",
  "foia-logs": "universal gates pass; needs fixture for deep entry",
  "iborrowdesk": "universal gates pass; needs fixture for deep entry",
  "levels-fyi": "universal gates pass; needs fixture for deep entry",
  "open-payments": "universal gates pass; needs fixture for deep entry",
  "short-campaigns": "universal gates pass; needs fixture for deep entry",
  "trials": "universal gates pass; needs fixture for deep entry",
  "workplace": "universal gates pass; needs fixture for deep entry",
};

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

  test("every builtin pane is audited or explicitly exempt", () => {
    const missing = builtinPaneIds().filter((id) => !AUDITED_PANES.has(id) && !(id in EXEMPT_PANES));
    expect(
      missing,
      `new panes need a design entry in pane-design-conformance.test.ts: ${missing.join(", ")}`,
    ).toEqual([]);
    const staleExemptions = Object.keys(EXEMPT_PANES).filter(
      (id) => !builtinPaneIds().includes(id) && EXEMPT_PANES[id] !== "audited",
    );
    expect(staleExemptions, `remove stale exemptions: ${staleExemptions.join(", ")}`).toEqual([]);
  });

  describe("all builtin panes (universal gates)", () => {
    const deepAudited = new Set([
      "plugin-marketplace",
    ]);
    const entries = uiBuiltinPlugins.flatMap((plugin) =>
      (plugin.panes ?? []).map((pane) => ({ pluginId: plugin.id, pane })),
    );

    let rendered: AuditedPaneRender | undefined;
    afterEach(async () => {
      await rendered?.destroy();
      rendered = undefined;
      setHttpFetchTransport(null);
      setCloudApiFetchTransport(null as never);
      resetRegistryFeedCacheForTests();
    });

    for (const { pluginId, pane } of entries) {
      if (deepAudited.has(pane.id)) continue;
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
        assertNoBannedBullets(rendered.frame, pane.id);
        assertFooterHintsBound(rendered.footer, pane.id);
        assertFooterHintKeysBindable(rendered.footer, pane.id);
        assertFooterInfoIsStatusOnly(rendered.footer, pane.id);
        assertFooterHasNoResultCounts(rendered.footer, pane.id);
        assertBodyDoesNotRepeatPaneName(rendered.frame, pane.id, pane.name);
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
});
