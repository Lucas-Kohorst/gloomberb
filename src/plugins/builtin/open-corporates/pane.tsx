import { Box, type InputRenderable } from "../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PaneProps } from "../../../types/plugin";
import {
  EmptyState,
  FeedDataTableStackView,
  InputSearchBar,
  Spinner,
  useUpdatedAgo,
  type FeedDataTableItem,
} from "../../../components";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import { useDebouncedPluginPaneState, usePluginPaneState } from "../../runtime";
import { usePaneSettingValue } from "../../../state/app/context";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { OpenCorporatesClient } from "./client";
import {
  OPEN_CORPORATES_PLUGIN_ID,
  type OpenCorporatesCompany,
  type OpenCorporatesOfficer,
} from "./types";

const SEARCH_DEBOUNCE_MS = 250;
const REFRESH_INTERVAL_MINUTES = 15;
const MAX_OFFICERS_SHOWN = 10;

function formatDate(date: Date): string {
  return date.getTime() === 0 ? "—" : date.toISOString().slice(0, 10);
}

function formatOfficer(officer: OpenCorporatesOfficer): string {
  const tenure = [officer.startDate, officer.endDate].filter(Boolean).join(" – ");
  const role = officer.position ? ` (${officer.position})` : "";
  return `- ${officer.name}${role}${tenure ? ` · ${tenure}` : ""}`;
}

function buildDetailBody(
  company: OpenCorporatesCompany,
  officers: OpenCorporatesOfficer[] | undefined,
): string {
  const lines = [
    `Number: ${company.companyNumber}`,
    `Jurisdiction: ${company.jurisdictionCode}`,
    `Status: ${company.currentStatus || (company.inactive ? "Inactive" : "—")}`,
    `Type: ${company.companyType || "—"}`,
    `Incorporated: ${formatDate(company.incorporationDate)}`,
    `Address: ${company.registeredAddress || "—"}`,
    "",
    "Officers:",
    ...(officers === undefined
      ? ["- Open the record to load officers."]
      : officers.length === 0
        ? ["- None published."]
        : officers.slice(0, MAX_OFFICERS_SHOWN).map(formatOfficer)),
  ];
  if (officers && officers.length > MAX_OFFICERS_SHOWN) {
    lines.push(`- +${officers.length - MAX_OFFICERS_SHOWN} more`);
  }
  return lines.join("\n");
}

function toFeedItems(
  companies: OpenCorporatesCompany[],
  officersById: Record<string, OpenCorporatesOfficer[]>,
): FeedDataTableItem[] {
  return companies.map((company) => {
    const status = company.currentStatus || (company.inactive ? "Inactive" : "—");
    return {
      id: company.id,
      eyebrow: company.jurisdictionCode,
      title: `${company.name}  ·  ${status}`,
      timestamp: company.incorporationDate.getTime() === 0 ? null : company.incorporationDate,
      detailTitle: company.name,
      detailMeta: [
        `${company.jurisdictionCode} · ${company.companyNumber}`,
        status,
        `incorporated ${formatDate(company.incorporationDate)}`,
      ],
      detailBody: buildDetailBody(company, officersById[company.id]),
    };
  });
}

export function OpenCorporatesPane({ width, height, focused }: PaneProps) {
  const client = useMemo(() => new OpenCorporatesClient(), []);
  const [storedQuery] = usePaneSettingValue("query", "");
  const [query, setQuery] = usePluginPaneState("query", String(storedQuery ?? "").trim());
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);
  const [companies, setCompanies] = useState<OpenCorporatesCompany[]>([]);
  const [officersById, setOfficersById] = useState<Record<string, OpenCorporatesOfficer[]>>({});
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useDebouncedPluginPaneState<number>("selectedIdx", 0);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const requestRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback((nextQuery: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestRef.current;
    setStatus("loading");
    setError(null);
    if (!nextQuery.trim()) {
      setCompanies([]);
      setStatus("loaded");
      return;
    }
    void client.searchCompanies(nextQuery, controller.signal)
      .then((page) => {
        if (requestRef.current !== requestId || controller.signal.aborted) return;
        setCompanies(page.companies);
        setSelectedIdx(0);
        setStatus("loaded");
        setLastUpdated(Date.now());
      })
      .catch((loadError) => {
        if (requestRef.current !== requestId || controller.signal.aborted) return;
        setCompanies([]);
        setStatus("error");
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      });
  }, [client, setSelectedIdx]);

  useEffect(() => {
    const timeoutId = setTimeout(() => load(query), query ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timeoutId);
  }, [load, query]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const selectedCompany = companies[selectedIdx] ?? null;
  const detailCompany = openItemId
    ? companies.find((company) => company.id === openItemId) ?? selectedCompany
    : selectedCompany;

  useEffect(() => {
    if (!openItemId || !detailCompany || officersById[detailCompany.id] !== undefined) return;
    let cancelled = false;
    void client.getCompany(detailCompany.jurisdictionCode, detailCompany.companyNumber)
      .then((detail) => {
        if (cancelled || !detail) return;
        setOfficersById((current) => ({ ...current, [detail.id]: detail.officers }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [openItemId, detailCompany, officersById, client]);

  const loading = status === "loading" && companies.length === 0;
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  useAutoRefresh(status === "loaded" && query ? lastUpdated : null, () => load(query), REFRESH_INTERVAL_MINUTES);
  const items = useMemo(() => toFeedItems(companies, officersById), [companies, officersById]);

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((token) => token + 1);
  }, []);
  const updateQuery = useCallback((value: string) => {
    setQuery(value.trim());
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
    } else if (isPlainKey(event, "r")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      load(query);
    }
  }, { allowEditable: true, enabled: focused });

  usePaneStatusLinkFooter({
    registrationId: OPEN_CORPORATES_PLUGIN_ID,
    focused,
    url: detailCompany?.opencorporatesUrl || null,
    source: detailCompany?.jurisdictionCode,
    label: "company",
    loading,
    error,
    info: updatedAgo
      ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
      : [],
    showOpenHint: !!detailCompany?.opencorporatesUrl && !error,
    hints: [
      { id: "search", key: "/", label: "search", onPress: focusSearch },
      { id: "refresh", key: "r", label: "efresh", onPress: () => load(query) },
    ],
  });

  const handleRootKeyDown = useCallback((event: {
    name?: string;
    preventDefault?: () => void;
    stopPropagation?: () => void;
  }, context: { selectedIndex: number }) => {
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
      placeholder="company name (e.g. Acme Ltd)"
      debounceMs={SEARCH_DEBOUNCE_MS}
      normalizeValue={(value) => value.trim()}
      onFocus={focusSearch}
      onBlur={() => setSearchFocused(false)}
      onNavigateDown={() => setSearchFocused(false)}
      onQueryChange={updateQuery}
    />
  );

  if (loading) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label={query ? `Searching companies for ${query}...` : "Loading companies..."} />
        </Box>
      </Box>
    );
  }
  if (error && companies.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center" padding={1}>
          <EmptyState title="Company search unavailable." message={error} hint="Press r to retry." />
        </Box>
      </Box>
    );
  }

  return (
    <FeedDataTableStackView
      width={width}
      height={height}
      focused={focused && !searchFocused}
      rootBefore={rootBefore}
      items={items}
      selectedIdx={selectedIdx}
      onSelect={setSelectedIdx}
      onOpenItemIdChange={setOpenItemId}
      onRootKeyDown={handleRootKeyDown}
      sourceLabel="Jurisdiction"
      titleLabel="Company · Status"
      emptyStateTitle={query ? `No companies match ${query}.` : "Press / to search companies."}
    />
  );
}
