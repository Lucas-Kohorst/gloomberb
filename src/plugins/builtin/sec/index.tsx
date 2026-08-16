import { Box, Text, type InputRenderable } from "../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PluginModule } from "../plugin-module";
import type { PaneProps, PaneTemplateCreateOptions, PaneTemplateContext } from "../../../types/plugin";
import type { SecFilingDocument, SecFilingItem } from "../../../types/data-provider";
import { useResolvedEntryValue, useSecFilingDocuments, useSecFilingsQuery } from "../../../market-data/hooks";
import { instrumentFromTicker } from "../../../market-data/request-types";
import { useDebouncedPluginPaneState, usePluginPaneState } from "../../runtime";
import { usePaneSettingValue, usePaneTicker } from "../../../state/app/context";
import { colors } from "../../../theme/colors";
import {
  FeedDataTableStackView,
  InputSearchBar,
  Spinner,
  type FeedDataTableItem,
} from "../../../components";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import { isUsEquityTicker } from "../../../utils/sec";
import { parseForm4Xml, transactionTypeLabel } from "../insider/insider-data";
import { formatCompact, formatCurrency } from "../../../utils/format";
import { registerConnectionSource } from "../connections/register";
import { loadSecBrowserFilings } from "./client";
import {
  formatFilingMetaDate,
  renderFilingNotice,
} from "./filing-display";
import {
  documentContentKey,
  documentHeading,
  formatCompactDocumentLabel,
  isDefaultVisibleFilingDocument,
  isInlineExhibitDocument,
} from "./filing-documents";
import {
  buildInlineFilingContentTargets,
  useSecFilingContentCache,
} from "./filing-content";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";

const SEC_FILING_LIMIT = 50;
const OWNERSHIP_FORMS = new Set(["3", "4", "5"]);

function getDisplayFormLabel(form: string): string {
  const trimmed = form.trim();
  return /^\d+(?:\/[A-Z])?$/i.test(trimmed)
    ? `FORM ${trimmed}`
    : trimmed;
}

function normalizeComparableText(value: string): string {
  return value
    .toUpperCase()
    .replace(/\bFORM\b/g, "")
    .replace(/[^A-Z0-9]+/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripRedundantFormPrefix(form: string, description: string): string {
  const pattern = escapeRegExp(form.trim()).replace(/\s+/g, "\\s+");
  return description
    .trim()
    .replace(new RegExp(`^(?:FORM\\s+)?${pattern}(?:\\s*[:|-]\\s*|\\s+)`, "i"), "")
    .trim();
}

function getMeaningfulPrimaryDescription(filing: SecFilingItem): string | undefined {
  const description = filing.primaryDocDescription?.trim();
  if (!description) return undefined;
  if (normalizeComparableText(description) === normalizeComparableText(filing.form)) return undefined;

  const stripped = stripRedundantFormPrefix(filing.form, description);
  if (!stripped) return undefined;
  if (normalizeComparableText(stripped) === normalizeComparableText(filing.form)) return undefined;
  return stripped;
}

function getFilingDisplayTitle(filing: SecFilingItem): string {
  const description = getMeaningfulPrimaryDescription(filing);
  const formLabel = getDisplayFormLabel(filing.form);
  return description ? `${formLabel} | ${description}` : formLabel;
}

function formatFiledAt(filing: SecFilingItem): string {
  return formatFilingMetaDate(filing.filingDate);
}

function buildDetailBody(filing: SecFilingItem): string {
  const sections = [
    getMeaningfulPrimaryDescription(filing),
    filing.items ? `Items: ${filing.items}` : undefined,
    filing.primaryDocument ? `Primary document: ${filing.primaryDocument}` : undefined,
  ].filter((value): value is string => !!value && value.trim().length > 0);

  return sections.length > 0
    ? sections.join("\n\n")
    : "No additional SEC filing description is available for this entry.";
}

function buildDetailBodyWithDocuments({
  filing,
  documents,
  documentsLoading,
  contentCache,
  primaryContent,
}: {
  filing: SecFilingItem;
  documents: SecFilingDocument[];
  documentsLoading: boolean;
  contentCache: Map<string, string | null>;
  primaryContent: string;
}): string {
  const lines: string[] = [];
  lines.push("Documents");
  if (documentsLoading && documents.length === 0) {
    lines.push("Loading filing documents...");
  } else if (documents.length === 0) {
    lines.push("No filing documents were listed for this filing.");
  } else {
    const visibleDocuments = documents.filter(isDefaultVisibleFilingDocument);
    lines.push(...visibleDocuments.map(formatCompactDocumentLabel));
    const hiddenCount = documents.length - visibleDocuments.length;
    if (hiddenCount > 0) lines.push(`+ ${hiddenCount} support documents hidden`);
  }

  const exhibits = documents.filter(isInlineExhibitDocument);
  if (exhibits.length > 0) {
    lines.push("", "Inline Exhibits");
    for (const document of exhibits) {
      const key = documentContentKey(filing, document);
      const hasContent = contentCache.has(key);
      const content = contentCache.get(key);
      lines.push("", documentHeading(document));
      lines.push(hasContent
        ? content || "Readable document content was not available for this exhibit."
        : "Loading exhibit content...");
    }
  }

  lines.push("", "Primary Filing Content", primaryContent);
  return lines.join("\n");
}

function buildForm4Preview(content: string | null): string | null {
  if (!content) return null;
  const tx = parseForm4Xml(content);
  if (!tx) return null;
  const type = transactionTypeLabel(tx.transactionType);
  const shares = formatCompact(tx.shares);
  const price = tx.pricePerShare != null ? ` @ ${formatCurrency(tx.pricePerShare)}` : "";
  return `${tx.reportedName} — ${type} ${shares} shares${price}`;
}

function buildForm4Detail(content: string | null, filing: SecFilingItem): string {
  if (!content) return buildDetailBody(filing);
  const tx = parseForm4Xml(content);
  if (!tx) return buildDetailBody(filing);

  const lines: string[] = [];
  lines.push(`Insider: ${tx.reportedName}`);
  if (tx.title) lines.push(`Title: ${tx.title}`);
  lines.push(`Transaction: ${transactionTypeLabel(tx.transactionType)}`);
  lines.push(`Shares: ${formatCompact(tx.shares)}`);
  if (tx.pricePerShare != null) lines.push(`Price/Share: ${formatCurrency(tx.pricePerShare)}`);
  if (tx.totalValue != null) lines.push(`Total Value: ${formatCurrency(tx.totalValue)}`);
  if (tx.sharesOwned != null) lines.push(`Shares Owned After: ${formatCompact(tx.sharesOwned)}`);
  return lines.join("\n");
}

function getFormDescription(form: string): string {
  const f = form.trim().toUpperCase();
  switch (f) {
    case "10-K": return "Annual Report";
    case "10-K/A": return "Annual Report (Amended)";
    case "10-Q": return "Quarterly Report";
    case "10-Q/A": return "Quarterly Report (Amended)";
    case "8-K": return "Current Report";
    case "8-K/A": return "Current Report (Amended)";
    case "4": return "Insider Transaction";
    case "3": return "Initial Insider Ownership";
    case "5": return "Annual Insider Ownership";
    case "SC 13G": return "Beneficial Ownership (Passive)";
    case "SC 13G/A": return "Beneficial Ownership (Amended)";
    case "SC 13D": return "Beneficial Ownership (Active)";
    case "SC 13D/A": return "Beneficial Ownership (Amended)";
    case "DEF 14A": return "Proxy Statement";
    case "S-1": return "Registration Statement";
    case "20-F": return "Annual Report (Foreign)";
    default: return "";
  }
}

function filingEntityLabel(filing: SecFilingItem): string | undefined {
  if (filing.ticker && filing.companyName) return `${filing.companyName} (${filing.ticker})`;
  return filing.companyName || filing.ticker || undefined;
}

function toFeedItems(
  filings: SecFilingItem[],
  selectedAccessionNumber: string | undefined,
  contentCache: Map<string, string | null>,
  loadingContent: boolean,
  selectedDocuments: SecFilingDocument[],
  loadingDocuments: boolean,
  showEntity = false,
): FeedDataTableItem[] {
  return filings.map((filing) => {
    const displayTitle = getFilingDisplayTitle(filing);
    const formDesc = getFormDescription(filing.form);
    const hasFetchedContent = contentCache.has(filing.accessionNumber);
    const fetchedContent = contentCache.get(filing.accessionNumber);
    const isOwnership = OWNERSHIP_FORMS.has(filing.form.trim());
    const fallbackBody = hasFetchedContent && !loadingContent && !fetchedContent
      ? `${buildDetailBody(filing)}\n\nReadable filing content was not available for this document.`
      : buildDetailBody(filing);

    // For Form 4s, build structured preview and detail from parsed XML
    const form4Preview = isOwnership && hasFetchedContent
      ? buildForm4Preview(fetchedContent ?? null)
      : null;
    const form4Detail = isOwnership && hasFetchedContent
      ? buildForm4Detail(fetchedContent ?? null, filing)
      : null;
    const selected = filing.accessionNumber === selectedAccessionNumber;
    const primaryDetailBody = loadingContent && selected
      ? "Loading filing content..."
      : form4Detail ?? fetchedContent ?? fallbackBody;
    const detailBody = selected
      ? buildDetailBodyWithDocuments({
          filing,
          documents: selectedDocuments,
          documentsLoading: loadingDocuments,
          contentCache,
          primaryContent: primaryDetailBody,
        })
      : form4Detail ?? fallbackBody;

    const entityLabel = showEntity ? filingEntityLabel(filing) : undefined;
    const enrichedTitle = [entityLabel, displayTitle, formDesc].filter(Boolean).join(" | ");
    const listTitle = form4Preview
      ? [entityLabel, displayTitle, form4Preview].filter(Boolean).join(" | ")
      : enrichedTitle;

    return {
      id: filing.accessionNumber,
      eyebrow: filing.ticker || filing.form,
      title: listTitle,
      timestamp: filing.filingDate,
      detailTitle: enrichedTitle,
      detailMeta: [
        `Filed ${formatFiledAt(filing)}`,
        `Accession ${filing.accessionNumber}`,
        ...(filing.items ? [`Items ${filing.items}`] : []),
      ],
      detailBody,
    };
  });
}

function SecTickerView({ width, height, focused }: { width: number; height: number; focused: boolean }) {
  const { ticker } = usePaneTicker();
  const selectionKey = `selectedIdx:${ticker?.metadata.ticker ?? "none"}`;
  const [selectedIdx, setSelectedIdx] = useDebouncedPluginPaneState<number>(selectionKey, 0);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const eligibleTicker = isUsEquityTicker(ticker);
  const instrument = instrumentFromTicker(ticker, ticker?.metadata.ticker ?? null);
  const filingsEntry = useSecFilingsQuery(
    instrument && eligibleTicker
      ? { instrument, count: SEC_FILING_LIMIT }
      : null,
  );
  const filings = useResolvedEntryValue(filingsEntry) ?? [];
  const loading = filingsEntry?.phase === "loading" || (filingsEntry?.phase === "refreshing" && filings.length === 0);
  const error = filingsEntry?.phase === "error" ? filingsEntry.error?.message ?? "Failed to load SEC filings" : null;

  const openFiling = openItemId
    ? filings.find((filing) => filing.accessionNumber === openItemId) ?? null
    : null;
  const documentsEntry = useSecFilingDocuments(openFiling ?? null);
  const openDocuments = useResolvedEntryValue(documentsEntry) ?? [];
  const loadingDocuments = !!openFiling && (
    documentsEntry?.phase === "idle"
    || documentsEntry?.phase === "loading"
    || documentsEntry?.phase === "refreshing"
  );

  const contentTargets = useMemo(() => [
    ...(openFiling ? [openFiling] : []),
    ...buildInlineFilingContentTargets(openFiling, openDocuments),
    ...filings.filter((filing) => OWNERSHIP_FORMS.has(filing.form.trim())),
  ], [filings, openDocuments, openFiling]);
  const { contentCache } = useSecFilingContentCache({
    scopeKey: `${ticker?.metadata.ticker ?? "none"}:${ticker?.metadata.exchange ?? ""}:${eligibleTicker}`,
    targets: contentTargets,
  });
  const loadingContent = !!openFiling && !contentCache.has(openFiling.accessionNumber);

  useEffect(() => {
    if (filings.length > 0 && selectedIdx >= filings.length) {
      setSelectedIdx(Math.max(0, filings.length - 1));
    }
  }, [filings.length, selectedIdx, setSelectedIdx]);

  usePaneStatusLinkFooter({
    registrationId: "sec",
    focused,
    url: error ? null : openFiling?.filingUrl,
    source: openFiling?.form,
    label: "filing",
    loading,
    error,
    showOpenHint: !error && !!openFiling?.filingUrl,
  });

  if (!ticker) return <Text fg={colors.textDim}>Select a ticker to view SEC filings.</Text>;
  if (!eligibleTicker) return renderFilingNotice("SEC filings are only shown for US equities.", width);
  if (loading && filings.length === 0) return <Spinner label="Loading SEC filings..." />;
  if (error) return renderFilingNotice(`Error: ${error}`, width);
  if (filings.length === 0) return renderFilingNotice(`No recent SEC filings for ${ticker.metadata.ticker}.`, width);

  return (
    <FeedDataTableStackView
      width={width}
      height={height}
      focused={focused}
      items={toFeedItems(
        filings,
        openFiling?.accessionNumber,
        contentCache,
        loadingContent,
        openDocuments,
        loadingDocuments,
      )}
      selectedIdx={selectedIdx}
      onSelect={setSelectedIdx}
      onOpenItemIdChange={setOpenItemId}
      sourceLabel="Form"
      titleLabel="Filing"
      emptyStateTitle="No SEC filings."
    />
  );
}

const SEARCH_DEBOUNCE_MS = 250;
const trimSearchValue = (value: string) => value.trim();

function queryFromTemplateOptions(options?: PaneTemplateCreateOptions): string {
  return (options?.arg ?? options?.symbol ?? options?.values?.query ?? "").trim();
}

function SecPane({ width, height, focused }: PaneProps) {
  const { ticker } = usePaneTicker();
  const [storedQuery] = usePaneSettingValue("query", "");
  const initialQuery = String(storedQuery ?? "").trim() || ticker?.metadata.ticker || "";
  const [query, setQuery] = usePluginPaneState("query", initialQuery);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);
  const [filings, setFilings] = useState<SecFilingItem[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useDebouncedPluginPaneState<number>("selectedIdx", 0);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback((nextQuery: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("loading");
    setError(null);
    void loadSecBrowserFilings(nextQuery)
      .then((nextFilings) => {
        if (abortRef.current !== controller) return;
        setFilings(nextFilings);
        setStatus("loaded");
      })
      .catch((loadError) => {
        if (abortRef.current !== controller) return;
        if (loadError instanceof Error && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setFilings([]);
        setStatus("error");
      });
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      load(query);
    }, query.trim() ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timeoutId);
  }, [load, query]);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  const openFiling = openItemId
    ? filings.find((filing) => filing.accessionNumber === openItemId) ?? null
    : null;
  const documentsEntry = useSecFilingDocuments(openFiling ?? null);
  const openDocuments = useResolvedEntryValue(documentsEntry) ?? [];
  const loadingDocuments = !!openFiling && (
    documentsEntry?.phase === "idle"
    || documentsEntry?.phase === "loading"
    || documentsEntry?.phase === "refreshing"
  );
  const contentTargets = useMemo(() => [
    ...(openFiling ? [openFiling] : []),
    ...buildInlineFilingContentTargets(openFiling, openDocuments),
    ...filings.filter((filing) => OWNERSHIP_FORMS.has(filing.form.trim())),
  ], [filings, openDocuments, openFiling]);
  const { contentCache } = useSecFilingContentCache({
    scopeKey: `browser:${query.trim().toLowerCase() || "latest"}`,
    targets: contentTargets,
  });
  const loadingContent = !!openFiling && !contentCache.has(openFiling.accessionNumber);
  const loading = status === "loading" && filings.length === 0;

  useEffect(() => {
    if (filings.length > 0 && selectedIdx >= filings.length) {
      setSelectedIdx(Math.max(0, filings.length - 1));
    }
  }, [filings.length, selectedIdx, setSelectedIdx]);

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((current) => current + 1);
  }, []);
  const blurSearch = useCallback(() => {
    setSearchFocused(false);
  }, []);
  const updateQuery = useCallback((nextQuery: string) => {
    setQuery(nextQuery);
    setSelectedIdx(0);
    setOpenItemId(null);
  }, [setQuery, setSelectedIdx]);

  useShortcut((event) => {
    if (!focused || openItemId) return;
    if (searchFocused) {
      if (isPlainKey(event, "escape")) {
        event.stopPropagation?.();
        event.preventDefault?.();
        setSearchFocused(false);
      }
      return;
    }
    if (event.targetEditable) return;
    if (isPlainKey(event, "/")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      focusSearch();
      return;
    }
    if (isPlainKey(event, "r")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      load(query);
    }
  }, { allowEditable: true, enabled: focused });

  usePaneStatusLinkFooter({
    registrationId: "sec",
    focused,
    url: error ? null : openFiling?.filingUrl,
    source: openFiling?.form,
    label: "filing",
    loading,
    error,
    showOpenHint: !error && !!openFiling?.filingUrl,
    hints: [
      { id: "search", key: "/", label: "search", onPress: focusSearch },
      { id: "refresh", key: "r", label: "efresh", onPress: () => load(query) },
    ],
  });

  const handleRootKeyDown = useCallback((event: { name?: string; preventDefault?: () => void; stopPropagation?: () => void }, context: { selectedIndex: number }) => {
    if (context.selectedIndex <= 0 && isPlainArrowUp(event)) {
      stopSearchFocusNavigation(event);
      focusSearch();
      return true;
    }
    if (event.name === "/") {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
      return true;
    }
    if (event.name === "r") {
      event.preventDefault?.();
      event.stopPropagation?.();
      load(query);
      return true;
    }
    return false;
  }, [focusSearch, load, query]);

  const rootBefore = (
    <InputSearchBar
      value={query}
      focused={focused && !openItemId}
      active={searchFocused}
      width={width}
      focusToken={searchFocusToken}
      inputRef={searchInputRef}
      placeholder="ticker, company, or form"
      debounceMs={SEARCH_DEBOUNCE_MS}
      normalizeValue={trimSearchValue}
      onFocus={focusSearch}
      onBlur={blurSearch}
      onNavigateDown={blurSearch}
      onQueryChange={updateQuery}
    />
  );

  if (loading) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label={query.trim() ? `Searching SEC for ${query.trim()}...` : "Loading latest SEC filings..."} />
        </Box>
      </Box>
    );
  }

  if (error && filings.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        {renderFilingNotice(`Error: ${error}`, width)}
      </Box>
    );
  }

  return (
    <FeedDataTableStackView
      width={width}
      height={height}
      focused={focused && !searchFocused}
      rootBefore={rootBefore}
      items={toFeedItems(
        filings,
        openFiling?.accessionNumber,
        contentCache,
        loadingContent,
        openDocuments,
        loadingDocuments,
        true,
      )}
      selectedIdx={selectedIdx}
      onSelect={setSelectedIdx}
      onOpenItemIdChange={setOpenItemId}
      onRootKeyDown={handleRootKeyDown}
      sourceLabel="Form"
      titleLabel="Filing"
      emptyStateTitle={query.trim() ? `No SEC filings for ${query.trim()}.` : "No recent SEC filings."}
    />
  );
}

let disposeSecConnection: (() => void) | null = null;

export const secModule: PluginModule = {
  panes: [
    {
      id: "sec",
      name: "SEC",
      icon: "S",
      component: SecPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 32 },
    },
  ],

  paneTemplates: [
    {
      id: "sec-pane",
      paneId: "sec",
      label: "SEC",
      description: "Latest SEC filings. Search a ticker or company, or open SEC AAPL to jump there.",
      keywords: ["sec", "filings", "10-k", "10-q", "8-k", "edgar"],
      shortcut: {
        prefix: "SEC",
        argPlaceholder: "ticker or company",
        argKind: "text",
        argOptional: true,
      },
      createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
        const query = queryFromTemplateOptions(options);
        return {
          instanceId: query
            ? `sec:${encodeURIComponent(query.toUpperCase()).replace(/%/g, "~")}`
            : "sec:latest",
          title: query ? `SEC ${query.toUpperCase()}` : "SEC",
          placement: "floating" as const,
          binding: { kind: "none" as const },
          settings: { query },
        };
      },
    },
  ],

  setup(ctx) {
    disposeSecConnection = registerConnectionSource({
      id: "sec-edgar",
      name: "SEC EDGAR",
      kind: "api",
      pluginId: "sec",
      priority: 700,
    });
    ctx.registerTickerResearchTab({
      id: "sec",
      name: "SEC",
      order: 45,
      component: SecTickerView,
      isVisible: ({ ticker }) => isUsEquityTicker(ticker),
    });
  },

  dispose() {
    disposeSecConnection?.();
    disposeSecConnection = null;
  },
};
