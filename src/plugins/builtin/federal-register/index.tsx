import { Box, Text, type InputRenderable } from "../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NewsArticle } from "../../../news/types";
import type { GloomPlugin, PaneProps, PaneTemplateCreateOptions, PaneTemplateContext } from "../../../types/plugin";
import {
  FeedDataTableStackView,
  InputSearchBar,
  Spinner,
  useUpdatedAgo,
  type FeedDataTableItem,
} from "../../../components";
import { useShortcut } from "../../../react/input";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import { isPlainKey } from "../../../utils/keyboard";
import { colors } from "../../../theme/colors";
import { useDebouncedPluginPaneState, usePluginPaneState } from "../../runtime";
import { usePaneSettingValue } from "../../../state/app/context";
import { registerConnectionSource } from "../connections/register";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { usePopOutNewsArticle } from "../news/wire/news/pop-out";
import { FederalRegisterClient } from "./client";
import {
  FEDERAL_REGISTER_CONNECTION_ID,
  FEDERAL_REGISTER_PLUGIN_ID,
  type FedRegisterDoc,
  type FedRegisterDetail,
} from "./types";

const typeLabels: Record<string, string> = {
  RULE: "Rule",
  PROPOSED_RULE: "Proposed",
  NOTICE: "Notice",
  PRESIDENTIAL_DOCUMENT: "Presidential",
};
const formatDate = (date: Date) => date.getTime() ? date.toISOString().slice(0, 10) : "—";
const queryFromOptions = (options?: PaneTemplateCreateOptions) =>
  (options?.arg ?? options?.values?.query ?? "").trim();

function toArticle(doc: FedRegisterDoc, detail: FedRegisterDetail | null): NewsArticle {
  return {
    id: `federal-register:${doc.documentNumber}`,
    title: doc.title,
    url: detail?.sourceUrl ?? doc.htmlUrl,
    source: "Federal Register",
    publishedAt: doc.publicationDate,
    summary: doc.abstract,
    topic: "filing",
    topics: ["filing", "federal register", doc.type.toLowerCase()],
    sectors: [],
    categories: ["Federal Register", typeLabels[doc.type] ?? doc.type],
    tickers: [],
    scores: { importance: 0, urgency: 0, marketImpact: 0, novelty: 0, confidence: 0 },
    isBreaking: false,
    isDeveloping: false,
    importance: 0,
    origin: "federal-register",
    body: detail?.bodyHtml || undefined,
  };
}

function detailMeta(doc: FedRegisterDoc): string[] {
  return [
    ...doc.agencies,
    doc.regulatoryIdNumber,
    doc.significant ? "Significant" : "",
    doc.commentsCloseDate ? `comments close ${formatDate(doc.commentsCloseDate)}` : "",
  ].filter(Boolean);
}

function itemsFor(
  docs: FedRegisterDoc[],
  selectedIdx: number,
  detail: FedRegisterDetail | null,
  detailLoading: boolean,
): FeedDataTableItem[] {
  return docs.map((doc, index) => ({
    id: doc.documentNumber,
    eyebrow: `${typeLabels[doc.type] ?? doc.type} · ${doc.agencies[0] ?? "Federal Register"}`,
    title: doc.title,
    timestamp: doc.publicationDate,
    detailTitle: doc.title,
    detailMeta: [formatDate(doc.publicationDate), ...detailMeta(doc)],
    detailBody: index === selectedIdx
      ? detailLoading
        ? "Loading document detail..."
        : [doc.abstract, detail?.bodyHtml].filter(Boolean).join("\n\n") || "No further detail was published."
      : doc.abstract || "No abstract was published.",
  }));
}

function FederalRegisterPane({ width, height, focused }: PaneProps) {
  const client = useMemo(() => new FederalRegisterClient(), []);
  const [storedQuery] = usePaneSettingValue("query", "");
  const [query, setQuery] = usePluginPaneState("query", String(storedQuery ?? "").trim());
  const [searchFocused, setSearchFocused] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const inputRef = useRef<InputRenderable | null>(null);
  const [docs, setDocs] = useState<FedRegisterDoc[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useDebouncedPluginPaneState<number>("selectedIdx", 0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FedRegisterDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const cache = useRef(new Map<string, FedRegisterDetail>());
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback((value: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("loading"); setError(null);
    void client.searchDocuments(value).then((page) => {
      if (abortRef.current !== controller) return;
      setDocs(page.documents); setStatus("loaded"); setLastUpdated(Date.now());
    }).catch((loadError) => {
      if (abortRef.current !== controller || loadError instanceof Error && loadError.name === "AbortError") return;
      setDocs([]); setStatus("error"); setError(loadError instanceof Error ? loadError.message : String(loadError));
    });
  }, [client]);

  useEffect(() => {
    const id = setTimeout(() => load(query), query.trim() ? 250 : 0);
    return () => clearTimeout(id);
  }, [load, query]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const selected = docs[selectedIdx] ?? null;
  const openDoc = openId ? docs.find((doc) => doc.documentNumber === openId) ?? null : null;
  const activeDoc = openDoc ?? selected;
  useEffect(() => {
    if (!activeDoc) { setDetail(null); setDetailLoading(false); return; }
    const cached = cache.current.get(activeDoc.documentNumber);
    if (cached) { setDetail(cached); setDetailLoading(false); return; }
    let cancelled = false;
    setDetail(null); setDetailLoading(true);
    const id = setTimeout(() => void client.getDocumentDetail(activeDoc.documentNumber).then((next) => {
      if (cancelled) return;
      if (next) cache.current.set(activeDoc.documentNumber, next);
      setDetail(next); setDetailLoading(false);
    }).catch(() => { if (!cancelled) { setDetail(null); setDetailLoading(false); } }), 300);
    return () => { cancelled = true; clearTimeout(id); };
  }, [activeDoc, client]);

  const focusSearch = useCallback(() => { setSearchFocused(true); setFocusToken((token) => token + 1); }, []);
  const popOut = usePopOutNewsArticle(() => setOpenId(null));
  const popOutSelected = useCallback(() => { if (activeDoc) popOut(toArticle(activeDoc, detail)); }, [activeDoc, detail, popOut]);
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  useAutoRefresh(status === "loaded" ? lastUpdated : null, () => load(query), 15);
  const items = useMemo(() => itemsFor(docs, selectedIdx, detail, detailLoading), [docs, selectedIdx, detail, detailLoading]);

  useShortcut((event) => {
    if (!focused || openId || searchFocused || event.targetEditable) return;
    if (isPlainKey(event, "/")) { event.preventDefault?.(); event.stopPropagation?.(); focusSearch(); }
    if (isPlainKey(event, "r")) { event.preventDefault?.(); event.stopPropagation?.(); load(query); }
  }, { allowEditable: true, enabled: focused });
  usePaneStatusLinkFooter({
    registrationId: FEDERAL_REGISTER_PLUGIN_ID, focused, url: detail?.sourceUrl ?? activeDoc?.htmlUrl ?? null,
    source: "Federal Register", label: "document", loading: status === "loading" && docs.length === 0, error,
    info: updatedAgo ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }] : [],
    showOpenHint: !error && !!(detail?.sourceUrl ?? activeDoc?.htmlUrl),
    hints: [
      { id: "search", key: "/", label: "search", onPress: focusSearch },
      { id: "refresh", key: "r", label: "efresh", onPress: () => load(query) },
      ...(activeDoc ? [{ id: "pop-out", key: "p", label: "op out", onPress: popOutSelected }] : []),
    ],
  });
  const rootBefore = <InputSearchBar value={query} focused={focused && !openId} active={searchFocused}
    width={width} focusToken={focusToken} inputRef={inputRef} placeholder="keyword, agency, or topic"
    debounceMs={250} normalizeValue={(value) => value.trim()} onFocus={() => setSearchFocused(true)}
    onBlur={() => setSearchFocused(false)} onNavigateDown={() => setSearchFocused(false)}
    onQueryChange={(value) => { setQuery(value); setSelectedIdx(0); setOpenId(null); }} />;
  if (status === "loading" && docs.length === 0) return <Box flexDirection="column" width={width} height={height}>{rootBefore}<Box flexGrow={1} justifyContent="center" alignItems="center"><Spinner label={query ? `Searching Federal Register for ${query}...` : "Loading Federal Register..."} /></Box></Box>;
  if (error && docs.length === 0) return <Box flexDirection="column" width={width} height={height}>{rootBefore}<Box flexGrow={1} justifyContent="center" alignItems="center" padding={1}><Text fg={colors.textDim}>Error: {error}</Text></Box></Box>;
  return <FeedDataTableStackView width={width} height={height} focused={focused && !searchFocused} rootBefore={rootBefore}
    items={items} selectedIdx={selectedIdx} onSelect={setSelectedIdx}
    onOpenItemIdChange={setOpenId} markdown onRootKeyDown={(event, context) => {
      if (context.selectedIndex <= 0 && isPlainArrowUp(event)) { stopSearchFocusNavigation(event); focusSearch(); return true; }
      if (event.name === "/") { event.preventDefault?.(); event.stopPropagation?.(); focusSearch(); return true; }
      if (event.name === "r") { event.preventDefault?.(); event.stopPropagation?.(); load(query); return true; }
      return false;
    }} sourceLabel="Type / Agency" titleLabel="Document"
    emptyStateTitle={query ? `No Federal Register documents match ${query}.` : "No recent Federal Register documents."} />;
}

let disposeConnection: (() => void) | null = null;
export const federalRegisterPlugin: GloomPlugin = {
  id: FEDERAL_REGISTER_PLUGIN_ID, name: "Federal Register", version: "1.0.0",
  description: "Search Federal Register documents: proposed rules, final rules, and agency notices.", toggleable: true,
  panes: [{ id: "federal-register", name: "Fed Register", icon: "R", component: FederalRegisterPane,
    defaultPosition: "right", defaultMode: "floating", defaultFloatingSize: { width: 100, height: 30 } }],
  paneTemplates: [{
    id: "federal-register-pane", paneId: "federal-register", label: "Fed Register",
    description: "Search Federal Register documents, proposed rules, final rules, and agency notices.",
    keywords: ["federal", "register", "regulation", "rules", "notices", "agency"],
    category: "Data", shortcut: { prefix: "FR", argPlaceholder: "keyword or agency", argKind: "text", argOptional: true },
    createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
      const query = queryFromOptions(options);
      return { instanceId: query ? `federal-register:${encodeURIComponent(query)}` : "federal-register:latest",
        title: query ? `Fed Register ${query}` : "Fed Register", placement: "floating" as const,
        binding: { kind: "none" as const }, settings: { query } };
    },
  }],
  setup() { disposeConnection = registerConnectionSource({ id: FEDERAL_REGISTER_CONNECTION_ID, name: "Federal Register", kind: "api", pluginId: FEDERAL_REGISTER_PLUGIN_ID, priority: 650, authRequired: false }); },
  dispose() { disposeConnection?.(); disposeConnection = null; },
};
export default federalRegisterPlugin;
