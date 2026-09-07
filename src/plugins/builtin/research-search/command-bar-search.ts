import type { CloudSearchDocType, CloudSearchHit } from "../../../api-client";
import type {
  CommandBarResultDef,
  CommandBarSearchProvider,
  GloomPluginContext,
} from "../../../types/plugin";
import { apiClient } from "../../../api-client";
import { getSharedRegistry } from "../../registry";
import { runDocumentSearch } from "./data";
import { requestDocumentFocus } from "./focus-handoff";
import {
  formatHitDate,
  formatHitDateShort,
  hitLeadIn,
  hitTypeLabel,
  researchSearchInstanceId,
  RESEARCH_SEARCH_TEMPLATE_ID,
  type ResearchSearchHit,
} from "./model";
import { parseMarkedSnippet } from "./snippet";

/**
 * Each hit costs two rows (title, then source and snippet), and the sheet now
 * takes about half the terminal rather than a fixed sixteen rows. Four apiece
 * fits both sections without pushing what follows off screen.
 */
const COMMAND_BAR_HIT_LIMIT = 4;

const NEWS_DOC_TYPES: CloudSearchDocType[] = ["news"];
const FILING_DOC_TYPES: CloudSearchDocType[] = ["transcript", "filing"];

export function hitResultDef(
  hit: CloudSearchHit,
  openHit: (hit: CloudSearchHit) => void,
  now = Date.now(),
  options?: { badge?: boolean },
): CommandBarResultDef {
  const leadIn = [hitLeadIn(hit), hit.ticker].filter(Boolean).join(" · ");
  const snippet = parseMarkedSnippet(hit.snippet).map((segment) => ({
    text: segment.text,
    emphasis: segment.marked ? "match" as const : undefined,
  }));
  // Source and ticker open the snippet line, so the right column is free for
  // the date, which is what decides whether a hit is still worth reading.
  const segments = leadIn
    ? [{ text: `${leadIn} · `, emphasis: "muted" as const }, ...snippet]
    : snippet;
  return {
    id: hit.id,
    label: hit.title,
    detail: [leadIn, formatHitDate(hit.publishedAt)].filter(Boolean).join(" · "),
    // CALL or the filing form. Dropped in the News section, where every row is
    // the same kind and a badge would only repeat the heading.
    badge: options?.badge === false ? undefined : hitTypeLabel(hit),
    right: formatHitDateShort(hit.publishedAt, now),
    lines: segments.length > 0 ? [{ segments }] : undefined,
    keywords: [hit.ticker, hitTypeLabel(hit)],
    execute: () => openHit(hit),
  };
}

export function pluginHitResultDef(
  providerId: string,
  hit: import("../../../types/plugin").DocumentSearchHit,
  openHit: (hit: ResearchSearchHit) => void,
  now = Date.now(),
): CommandBarResultDef {
  const snippet = parseMarkedSnippet(hit.snippet ?? "").map((segment) => ({
    text: segment.text,
    emphasis: segment.marked ? "match" as const : undefined,
  }));
  return {
    id: `${providerId}:${hit.id}`,
    label: hit.title,
    detail: [hit.source, hit.documentType, formatHitDate(hit.publishedAt)].filter(Boolean).join(" · "),
    badge: hit.documentType?.toUpperCase().slice(0, 6) || "DOC",
    right: formatHitDateShort(hit.publishedAt, now),
    lines: snippet.length > 0 ? [{ segments: snippet }] : undefined,
    keywords: hit.keywords,
    execute: () => openHit({ kind: "plugin", providerId, hit }),
  };
}

interface CorpusSectionOptions {
  id: string;
  category: string;
  priority: number;
  docTypes: CloudSearchDocType[];
  badge: boolean;
  /** Appended below the hits by the section that offers the whole corpus. */
  searchAllRow?: boolean;
}

/**
 * Full-text corpus hits for free text the command bar could not resolve. Every
 * failure — including the 402 a server-side refusal returns — degrades to no
 * rows at all: the command bar is not the place to learn that a background
 * search you never asked for went wrong.
 *
 * News is asked for in its own request rather than split out of a shared one: a
 * single response has to spend its row budget on whichever kind scored better,
 * so a query matching a hundred wire stories would leave no room for a filing.
 */
function createCorpusSearchProvider(
  ctx: GloomPluginContext,
  section: CorpusSectionOptions,
): CommandBarSearchProvider {
  const openSearchPane = (query: string) => {
    ctx.createPaneFromTemplate(RESEARCH_SEARCH_TEMPLATE_ID, { arg: query });
  };

  return {
    id: section.id,
    category: section.category,
    /**
     * Async sections sit below every synchronous one, ordered by how long they
     * take to arrive, so a late arrival only ever pushes rows below itself and
     * never the rows the eye is already on. Instruments answer in ~200ms, the
     * corpus in ~400ms, Ask AI later still; the view model pins those bands at
     * 100, 190/200 and 300.
     */
    priority: section.priority,
    minQueryLength: 3,
    debounceMs: 350,

    async provide(query, _context, signal) {
      // Only skip when there is no session at all, so a signed-out bar does not
      // spend a request per query to be told so. Deliberately not gated on the
      // cached user's plan: that cache is cleared whenever a session refresh
      // comes back empty, which leaves the app authenticated for every other
      // surface while reporting itself signed out here. Entitlement is the
      // server's answer anyway, and it already returns 401 or 402 on its own.
      const cloudRequest = apiClient.isSignedIn()
        ? runDocumentSearch(
          // One row per story: three matching paragraphs of one article is one
          // result, and the teaser has three rows to spend.
          {
            query,
            docTypes: section.docTypes,
            limit: COMMAND_BAR_HIT_LIMIT,
            count: false,
            distinct: true,
          },
          signal,
        ).then((response) => response.hits ?? []).catch(() => [] as CloudSearchHit[])
        : Promise.resolve([] as CloudSearchHit[]);

      const providers = section.id === "research-search:documents"
        ? getSharedRegistry()?.getAvailableDocumentSearchProviders() ?? []
        : [];
      const pluginRequests = providers.map(async (provider) => {
        if (query.trim().length < (provider.minQueryLength ?? 3)) return [];
        return provider.search(query, signal);
      });
      const [hits, pluginResults] = await Promise.all([
        cloudRequest,
        Promise.allSettled(pluginRequests),
      ]);

      const now = Date.now();
      const openHit = (target: ResearchSearchHit) => {
        openSearchPane(query);
        requestDocumentFocus(researchSearchInstanceId(query), target);
      };
      const rows = hits.map((hit) => hitResultDef(
        hit,
        (target) => openHit({ kind: "cloud", hit: target }),
        now,
        { badge: section.badge },
      ));
      if (providers.length > 0) {
        const successful = pluginResults.map((result) => (
          result.status === "fulfilled" ? result.value : []
        ));
        for (let index = 0; rows.length < COMMAND_BAR_HIT_LIMIT * 2; index += 1) {
          let found = false;
          for (let providerIndex = 0; providerIndex < providers.length; providerIndex += 1) {
            const hit = successful[providerIndex]?.[index];
            if (!hit || rows.length >= COMMAND_BAR_HIT_LIMIT * 2) continue;
            found = true;
            rows.push(pluginHitResultDef(providers[providerIndex]!.id, hit, openHit, now));
          }
          if (!found) break;
        }
      }
      if (!section.searchAllRow || rows.length === 0) return rows;
      return [
        ...rows,
        {
          id: "search-all",
          label: "Search all documents →",
          detail: "Earnings calls, news, SEC filings, and CFTC metadata",
          badge: "DOCS",
          right: "SRCH",
          execute: () => openSearchPane(query),
        },
      ];
    },
  };
}

export function createNewsSearchProvider(ctx: GloomPluginContext): CommandBarSearchProvider {
  return createCorpusSearchProvider(ctx, {
    id: "research-search:news",
    category: "News",
    priority: 190,
    docTypes: NEWS_DOC_TYPES,
    badge: false,
  });
}

export function createDocumentSearchProvider(ctx: GloomPluginContext): CommandBarSearchProvider {
  return createCorpusSearchProvider(ctx, {
    id: "research-search:documents",
    category: "Documents",
    priority: 200,
    docTypes: FILING_DOC_TYPES,
    badge: true,
    searchAllRow: true,
  });
}
