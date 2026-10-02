import { Box } from "../../../ui";
import { useCallback, useMemo, useRef, useState } from "react";
import type { PaneProps } from "../../../types/plugin";
import {
  FeedDataTableStackView,
  PaneListChrome,
  usePaneListSearch,
  PaneStatusBody,
  useUpdatedAgo,
  type FeedDataTableItem,
} from "../../../components";
import { useAsyncResource } from "../../../react/async-resource";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import { useDebouncedPluginPaneState, usePluginPaneState } from "../../runtime";
import { usePaneSettingValue } from "../../../state/app/context";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { pollFooterTrailingInfo, useFeedPollInterval } from "../shared/feed-poll-interval";
import { OpenCorporatesClient } from "./client";
import {
  OPEN_CORPORATES_PLUGIN_ID,
  type OpenCorporatesCompany,
  type OpenCorporatesOfficer,
} from "./types";

const EMPTY_COMPANIES: OpenCorporatesCompany[] = [];
const trimSearchValue = (value: string) => value.trim();

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
  officerNotice?: string,
): string {
  const lines = [
    `Type: ${company.companyType || "—"}`,
    `Address: ${company.registeredAddress || "—"}`,
    "",
    "Officers:",
    ...(officers === undefined
      ? [officerNotice ?? "Open the record to load officers."]
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
  officerState: { id: string | null; data: OpenCorporatesOfficer[] | null; loading: boolean; error: string | null },
): FeedDataTableItem[] {
  const officerNotice = officerState.loading
    ? "Loading officers..."
    : officerState.error ? "Officers unavailable. Press r to retry." : undefined;
  return companies.map((company) => {
    const status = company.currentStatus || (company.inactive ? "Inactive" : "—");
    return {
      id: company.id,
      eyebrow: company.jurisdictionCode,
      title: `${company.name}  ·  ${status}`,
      timestamp: company.incorporationDate.getTime() === 0 ? null : company.incorporationDate,
      timestampKind: "date",
      detailTitle: company.name,
      detailMeta: [
        `${company.jurisdictionCode} · ${company.companyNumber}`,
        status,
        `incorporated ${formatDate(company.incorporationDate)}`,
      ],
      detailBody: buildDetailBody(
        company,
        company.id === officerState.id ? officerState.data ?? undefined : undefined,
        company.id === officerState.id ? officerNotice : undefined,
      ),
    };
  });
}

export function OpenCorporatesPane({ width, height, focused }: PaneProps) {
  const client = useMemo(() => new OpenCorporatesClient(), []);
  const [storedQuery] = usePaneSettingValue("query", "");
  const [query, setQuery] = usePluginPaneState("query", String(storedQuery ?? "").trim());
  const [selectedId, setSelectedId] = useDebouncedPluginPaneState<string | null>("selectedId", null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const loader = useCallback(async (_force: boolean, signal: AbortSignal) => {
    const page = await client.searchCompanies(query, signal);
    return page.companies;
  }, [client, query]);
  const { data, loading: refreshing, error, updatedAt, reload: reloadCompanies } = useAsyncResource(query.trim() ? loader : null);
  const companies = data ?? EMPTY_COMPANIES;

  const selectedCompany = companies.find((company) => company.id === selectedId) ?? companies[0] ?? null;
  const openCompany = openItemId ? companies.find((company) => company.id === openItemId) ?? null : null;
  const detailCompany = openCompany ?? selectedCompany;

  const officersCache = useRef(new Map<string, OpenCorporatesOfficer[]>());
  const jurisdiction = openCompany?.jurisdictionCode;
  const companyNumber = openCompany?.companyNumber;
  const loadOfficers = useCallback(async (force: boolean, signal: AbortSignal) => {
    if (!openItemId || !jurisdiction || !companyNumber) return [];
    const cached = officersCache.current.get(openItemId);
    if (cached && !force) return cached;
    const detail = await client.getCompany(jurisdiction, companyNumber, signal);
    if (!detail) throw new Error("Company detail unavailable.");
    if (!signal.aborted) officersCache.current.set(openItemId, detail.officers);
    return detail.officers;
  }, [client, openItemId, jurisdiction, companyNumber]);
  const officers = useAsyncResource(openCompany ? loadOfficers : null);
  const refresh = useCallback(() => {
    void reloadCompanies();
    if (openItemId) void officers.reload();
  }, [reloadCompanies, openItemId, officers.reload]);

  const loading = refreshing && companies.length === 0;
  const updatedAgo = useUpdatedAgo(updatedAt);
  const poll = useFeedPollInterval({ overrideConfigKey: "pollIntervalMinutes", defaultMinutes: REFRESH_INTERVAL_MINUTES });
  useAutoRefresh(query ? updatedAt : null, reloadCompanies, poll.intervalMinutes);
  const items = useMemo(() => toFeedItems(companies, {
    id: openItemId, data: officers.data, loading: officers.loading, error: officers.error,
  }), [companies, openItemId, officers.data, officers.loading, officers.error]);

  const updateQuery = useCallback((value: string) => {
    setQuery(value);
    setSelectedId(null);
    setOpenItemId(null);
  }, [setQuery, setSelectedId]);
  const { search, searchFocused, focusSearch, handleSearchKey } = usePaneListSearch({
    focused: focused && !openItemId,
    value: query,
    onQueryChange: updateQuery,
    placeholder: "company name (e.g. Acme Ltd)",
    debounceMs: SEARCH_DEBOUNCE_MS,
    normalizeValue: trimSearchValue,
  });

  useShortcut((event) => {
    if (!focused || searchFocused || event.targetEditable) return;
    if (isPlainKey(event, "r")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      refresh();
    }
  }, { enabled: focused });

  usePaneStatusLinkFooter({
    registrationId: OPEN_CORPORATES_PLUGIN_ID,
    focused: focused && !searchFocused,
    url: detailCompany?.opencorporatesUrl || null,
    loading: refreshing || officers.loading,
    error: error ?? officers.error,
    info: updatedAgo
      ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
      : [],
    trailingInfo: [...pollFooterTrailingInfo(!openItemId, poll.segment)],
    showOpenHint: !!detailCompany?.opencorporatesUrl,
    hints: [
      ...(!openItemId ? [{ id: "search", key: "/", label: "search", onPress: focusSearch }] : []),
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
    if (handleSearchKey(event)) return true;
    if (isPlainKey(event, "r")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      refresh();
      return true;
    }
    return false;
  }, [focusSearch, handleSearchKey, refresh]);

  const rootBefore = <PaneListChrome width={width} focused={focused && !openItemId} search={search} />;

  if (loading || (error && companies.length === 0)) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <PaneStatusBody loading={loading} error={error} subject="Companies" onRetry={refresh} />
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
      selectedItemId={selectedCompany?.id ?? null}
      onSelect={(index) => setSelectedId(companies[index]?.id ?? null)}
      openItemId={openItemId}
      onOpenItemIdChange={setOpenItemId}
      onRootKeyDown={handleRootKeyDown}
      sourceLabel="Jurisdiction"
      titleLabel="Company · Status"
      emptyStateTitle={query ? `No companies match ${query}.` : "Press / to search companies."}
    />
  );
}
