import { Box, Text } from "../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TextAttributes, type ScrollBoxRenderable } from "../../../ui";
import {
  DataTableStackView,
  EmptyState,
  PaneListChrome,
  SegmentedControl,
  Spinner,
  usePaneListSearch,
  type DataTableCell,
  type DataTableKeyEvent,
  type PaneFooterSegment,
} from "../../../components";
import { usePluginPaneState } from "../../runtime";
import { useAutoRefresh } from "../shared/auto-refresh";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import type { PaneProps } from "../../../types/plugin";
import type { PluginModule } from "../plugin-module";
import { colors, blendHex } from "../../../theme/colors";
import type { EconEvent } from "./types";
import { EconDetailView } from "./detail-view";
import {
  COUNTRY_CYCLE,
  FILTER_CYCLE,
  attachEconCalendarPersistence,
  actualColor,
  dateKey,
  dayLabel,
  formatCountdown,
  formatStaleness,
  getCalendarCache,
  impactIndicator,
  loadCalendar,
  matchesCountry,
  matchesImpact,
  resetEconCalendarPersistence,
  type CountryFilter,
  type DisplayRow,
  type EconCalendarColumn,
  type ImpactFilter,
} from "./calendar-model";
import { paneSearchHint, usePaneStatusLinkFooter } from "../shared/pane-footer";
import { registerConnectionSource } from "../connections/register";
import { ECON_CALENDAR_CONNECTION_ID, ECON_CALENDAR_CONNECTION_NAME } from "./calendar-source";
import { useAppActive } from "../../../state/app/activity";
import { applySortPreference, nextSortPreference, type SortPreference } from "../../../utils/sort-values";
import { fredSeriesCatalog, fredSeriesUrl, resolveFredMapping } from "./fred-series-map";

let disposeEconCalendarConnection: (() => void) | null = null;

const IMPACT_LABELS: Record<ImpactFilter, string> = {
  all: "All",
  high: "High",
  medium: "Med",
  low: "Low",
};

function EconCalendarPane({ focused, width, height }: PaneProps) {
  const [initialCache] = useState(() => getCalendarCache());
  const [events, setEvents] = useState<EconEvent[]>(initialCache?.data ?? []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(initialCache?.stale ?? false);
  const [fetchedAt, setFetchedAt] = useState<number | null>(initialCache?.fetchedAt ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [impactFilter, setImpactFilter] = usePluginPaneState<ImpactFilter>("impactFilter", "all");
  const [countryFilter, setCountryFilter] = usePluginPaneState<CountryFilter>("countryFilter", "all");
  const [sortPreference, setSortPreference] = useState<SortPreference<EconCalendarColumn["id"]>>({
    columnId: null,
    direction: "asc",
  });
  const [now, setNow] = useState(Date.now());
  const today = new Date(now);
  const appActive = useAppActive();
  const [detailEvent, setDetailEvent] = useState<EconEvent | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const listSearch = usePaneListSearch({
    focused: focused && !detailEvent,
    value: searchQuery,
    onQueryChange: setSearchQuery,
    placeholder: "event, country, or release",
  });

  const fetchGenRef = useRef(0);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const headerScrollRef = useRef<ScrollBoxRenderable>(null);

  const load = useCallback(async (force = false) => {
    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setLoading(true);
    setError(null);

    try {
      const result = await loadCalendar(force);
      if (fetchGenRef.current !== gen) return;
      setEvents(result.data);
      setFetchedAt(result.fetchedAt);
      setStale(result.stale);
      setError(result.refreshError ?? null);
    } catch (err) {
      if (fetchGenRef.current !== gen) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (fetchGenRef.current === gen) {
        setLoading(false);
      }
    }
  }, []);

  // loadCalendar serves a fresh cache without a request, so the pane can always
  // ask and still follow the global cadence once the cache goes stale.
  useEffect(() => { void load(); }, [load]);
  const refresh = useCallback(() => { void load(false); }, [load]);
  useAutoRefresh(stale ? null : fetchedAt, refresh);

  // Tick every 30s to update staleness + countdown
  useEffect(() => {
    if (!appActive) return;
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, [appActive]);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const matching = events
      .filter((ev) => matchesImpact(ev, impactFilter) && matchesCountry(ev, countryFilter))
      .filter((ev) => !query || `${ev.event} ${ev.country} ${ev.actual ?? ""} ${ev.forecast ?? ""} ${ev.prior ?? ""}`.toLowerCase().includes(query))
      .sort((a, b) => b.date.getTime() - a.date.getTime());
    return applySortPreference(matching, sortPreference, (event, columnId) => {
      switch (columnId) {
        case "time": return event.time;
        case "impact": return ({ high: 3, medium: 2, low: 1 })[event.impact];
        case "country": return event.country;
        case "event": return event.event;
        case "actual": return event.actual;
        case "forecast": return event.forecast;
        case "prior": return event.prior;
      }
    });
  }, [countryFilter, events, impactFilter, searchQuery, sortPreference]);

  const { rows, nowRowIdx, nextUpcomingEventIdx } = useMemo(() => {
    // Build display rows with separator headers and NOW marker
    const today = new Date(now);
    const rows: DisplayRow[] = [];
    let lastDateKey = "";
    let nowInserted = false;
    const hasPastEvents = filtered.some((ev) => ev.date.getTime() <= now);
    const hasFutureEvents = filtered.some((ev) => ev.date.getTime() > now);

    for (let i = 0; i < filtered.length; i++) {
      const ev = filtered[i]!;
      const dk = dateKey(ev.date);

      // Insert date separator if new day
      if (dk !== lastDateKey) {
        lastDateKey = dk;
        rows.push({ kind: "separator", key: `separator-${dk}`, label: dayLabel(ev.date, today) });
      }

      // Reverse chronological order puts upcoming events above the present marker.
      if (hasPastEvents && hasFutureEvents && !nowInserted && ev.date.getTime() <= now) {
        nowInserted = true;
        rows.push({ kind: "now", key: "now" });
      }

      rows.push({ kind: "event", key: `event-${ev.id}-${i}`, event: ev, eventIdx: i });
    }

    let nowRowIdx = -1;
    let nextUpcomingEventIdx = -1;
    let nextUpcomingTime = Number.POSITIVE_INFINITY;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]!;
      if (row.kind === "event") {
        const eventTime = row.event.date.getTime();
        if (eventTime > now && eventTime < nextUpcomingTime) {
          nextUpcomingEventIdx = row.eventIdx;
          nextUpcomingTime = eventTime;
        }
      } else if (row.kind === "now") {
        nowRowIdx = r;
      }
    }

    return { rows, nowRowIdx, nextUpcomingEventIdx };
  }, [filtered, now]);

  const initialScrollDone = useRef(false);
  const initialSelectionDone = useRef(false);
  useEffect(() => {
    if (initialScrollDone.current || filtered.length === 0) return;
    const sb = scrollRef.current;
    if (sb?.viewport && nowRowIdx >= 0) {
      const scrollTarget = Math.max(0, nowRowIdx - 3);
      sb.scrollTo(scrollTarget);
    }
    initialScrollDone.current = true;
  }, [filtered.length, nowRowIdx]);
  useEffect(() => {
    if (filtered.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (selectedId && filtered.some((event) => event.id === selectedId)) return;
    if (!initialSelectionDone.current && nextUpcomingEventIdx >= 0) {
      initialSelectionDone.current = true;
      setSelectedId(filtered[nextUpcomingEventIdx]!.id);
      return;
    }
    initialSelectionDone.current = true;
    setSelectedId(filtered[0]!.id);
  }, [filtered, nextUpcomingEventIdx, selectedId]);

  // Next upcoming event for countdown
  const nextEvent = nextUpcomingEventIdx >= 0 ? filtered[nextUpcomingEventIdx] : undefined;
  const nextCountdown = nextEvent ? formatCountdown(nextEvent.date.getTime() - now) : null;
  const selectImpactFilter = useCallback((value: ImpactFilter) => {
    setImpactFilter(value);
  }, [setImpactFilter]);
  const selectCountryFilter = useCallback((value: CountryFilter) => {
    setCountryFilter(value);
  }, [setCountryFilter]);
  const cycleImpactFilter = useCallback(() => {
    setImpactFilter((prev) => FILTER_CYCLE[(FILTER_CYCLE.indexOf(prev) + 1) % FILTER_CYCLE.length]!);
  }, [setImpactFilter]);
  const cycleCountryFilter = useCallback(() => {
    setCountryFilter((prev) => COUNTRY_CYCLE[(COUNTRY_CYCLE.indexOf(prev) + 1) % COUNTRY_CYCLE.length]!);
  }, [setCountryFilter]);

  const handleRootKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (listSearch.handleSearchKey(event)) return true;
    if (listSearch.searchFocused) return false;
    if (event.name === "f") {
      event.stopPropagation?.();
      event.preventDefault?.();
      cycleImpactFilter();
      return true;
    }
    if (event.name === "c") {
      event.stopPropagation?.();
      event.preventDefault?.();
      cycleCountryFilter();
      return true;
    }
    return false;
  }, [cycleCountryFilter, cycleImpactFilter, listSearch.handleSearchKey, listSearch.searchFocused]);

  useShortcut((event) => {
    if (!focused || listSearch.searchFocused || event.targetEditable) return;
    if (!isPlainKey(event, "r")) return;
    event.stopPropagation?.();
    event.preventDefault?.();
    void load(true);
  }, { enabled: focused && !listSearch.searchFocused });

  const columns = useMemo<EconCalendarColumn[]>(() => [
    { id: "time", label: "TIME", width: 6, align: "left" },
    { id: "impact", label: "IMP", width: 4, align: "left" },
    { id: "country", label: "CTY", width: 3, align: "left" },
    { id: "event", label: "EVENT", width: 12, align: "left", flexGrow: 1 },
    { id: "actual", label: "ACTUAL", width: 9, align: "right" },
    { id: "forecast", label: "FORECAST", width: 10, align: "right" },
    { id: "prior", label: "PRIOR", width: 9, align: "right" },
  ], []);
  const separatorBg = blendHex(colors.bg, colors.border, 0.3);
  const staleness = fetchedAt ? formatStaleness(fetchedAt, now) : "";
  const filtersActive = impactFilter !== "all" || countryFilter !== "all" || searchQuery.trim().length > 0;
  const emptyStateTitle = filtersActive ? "No matching events." : "No economic events.";
  const emptyStateHint = filtersActive
    ? "Try a different search, impact, or country."
    : undefined;

  const selectedEvent = filtered.find((event) => event.id === selectedId);
  const activeEvent = detailEvent ?? selectedEvent;
  const activeFredMapping = useMemo(
    () => activeEvent ? resolveFredMapping(activeEvent.event, activeEvent.country) : null,
    [activeEvent],
  );
  const sourceUrl = activeFredMapping ? fredSeriesUrl(activeFredMapping.seriesId) : null;

  const calendarStatus = useMemo<PaneFooterSegment[]>(() => [
    ...(staleness ? [{ id: "updated", parts: [{ text: staleness, tone: "muted" as const }] }] : []),
  ], [staleness]);
  const calendarTrailing = useMemo<PaneFooterSegment[]>(() => [
    ...(stale ? [{ id: "stale", parts: [{ text: "STALE", tone: "warning" as const }] }] : []),
  ], [stale]);
  const calendarHints = useMemo(() => [
    paneSearchHint(listSearch.focusSearch, { disabled: listSearch.searchFocused }),
    { id: "impact-filter", key: "f", label: "ilter", onPress: cycleImpactFilter, disabled: listSearch.searchFocused },
    { id: "country-filter", key: "c", label: "ountry", onPress: cycleCountryFilter, disabled: listSearch.searchFocused },
  ], [cycleCountryFilter, cycleImpactFilter, listSearch.focusSearch, listSearch.searchFocused]);
  usePaneStatusLinkFooter({
    registrationId: "econ-calendar",
    focused: focused && !listSearch.searchFocused,
    url: sourceUrl,
    source: "FRED",
    label: "series",
    loading,
    error,
    info: calendarStatus,
    trailingInfo: calendarTrailing,
    showOpenHint: !!sourceUrl && !listSearch.searchFocused,
    hints: calendarHints,
  });

  const handleHeaderClick = useCallback((columnId: string) => {
    setSortPreference((current) => nextSortPreference(current, columnId as EconCalendarColumn["id"]));
  }, []);
  const openDisplayRow = useCallback((row: DisplayRow) => {
    if (row.kind !== "event") return;
    setDetailEvent(row.event);
  }, []);
  const renderSectionHeader = useCallback((row: DisplayRow) => {
    if (row.kind === "separator") {
      return {
        text: row.label,
        backgroundColor: separatorBg,
        color: colors.textBright,
        attributes: TextAttributes.BOLD,
      };
    }
    if (row.kind === "now") {
      // A filled band instead of repeated rule characters, so the desktop
      // webview paints a real background rather than terminal glyphs.
      return {
        text: " NOW ",
        color: colors.warning,
        backgroundColor: blendHex(colors.bg, colors.warning, 0.22),
        attributes: TextAttributes.BOLD,
      };
    }
    return null;
  }, [separatorBg]);
  const renderCell = useCallback((
    row: DisplayRow,
    column: EconCalendarColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    if (row.kind !== "event") return { text: "" };

    const ev = row.event;
    const selectedColor = rowState.selected ? colors.selectedText : undefined;

    switch (column.id) {
      case "time":
        return { text: ev.time, color: selectedColor ?? colors.textMuted };
      case "impact": {
        const indicator = impactIndicator(ev.impact);
        return {
          text: indicator.text,
          color: selectedColor ?? indicator.color,
        };
      }
      case "country":
        // The ISO code, not a flag emoji: emoji widths do not match a fixed
        // column and pushed the right-hand columns off the pane.
        return { text: ev.country, color: selectedColor ?? colors.textMuted };
      case "event":
        return { text: ev.event, color: selectedColor ?? colors.text };
      case "actual":
        return {
          text: ev.actual ?? "—",
          color: selectedColor ?? actualColor(ev.actual, ev.forecast),
        };
      case "forecast":
        return { text: ev.forecast ?? "—", color: selectedColor ?? colors.textDim };
      case "prior":
        return { text: ev.prior ?? "—", color: selectedColor ?? colors.textDim };
    }
  }, []);

  const filterControls = (
    <Box flexDirection="row" paddingX={1} gap={2} overflow="hidden" flexShrink={0} alignItems="center">
      <SegmentedControl
        options={FILTER_CYCLE.map((value) => ({ value, label: IMPACT_LABELS[value] }))}
        value={impactFilter}
        onChange={(value) => selectImpactFilter(value as ImpactFilter)}
      />
      <SegmentedControl
        options={COUNTRY_CYCLE.map((value) => ({ value, label: value === "all" ? "All" : value }))}
        value={countryFilter}
        onChange={(value) => selectCountryFilter(value as CountryFilter)}
      />
      <Box flexGrow={1} />
      {nextEvent && nextCountdown && width >= 88 && (
        <Text fg={colors.textMuted}>
          {`next ${nextEvent.event.slice(0, 16).trimEnd()} ${nextCountdown}`}
        </Text>
      )}
      {selectedEvent && (
        <Text fg={colors.textDim}>{dayLabel(selectedEvent.date, today)}</Text>
      )}
    </Box>
  );
  const rootBefore = (
    <Box flexDirection="column" flexShrink={0}>
      <PaneListChrome
        width={width}
        focused={focused && !detailEvent}
        search={listSearch.search}
      />
      {filterControls}
    </Box>
  );

  if (loading && events.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label="Loading economic events..." />
        </Box>
      </Box>
    );
  }

  if (error && events.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box padding={1} flexGrow={1}>
          <EmptyState
            title="Economic calendar unavailable."
            hint="Press r to retry."
          />
        </Box>
      </Box>
    );
  }

  const detailContent = detailEvent ? (
    <EconDetailView
      event={detailEvent}
      width={width}
      height={Math.max(height - 1, 1)}
      focused={focused}
    />
  ) : (
    <Box flexGrow={1} />
  );

  return (
    <DataTableStackView<DisplayRow, EconCalendarColumn>
      focused={focused && !listSearch.searchFocused}
      detailOpen={!!detailEvent}
      onBack={() => setDetailEvent(null)}
      detailContent={detailContent}
      detailTitle={detailEvent?.event}
      rootWidth={width}
      rootHeight={height}
      rootBefore={rootBefore}
      onRootKeyDown={handleRootKeyDown}
      selection={{
        kind: "id",
        selectedId,
        getId: (row) => row.kind === "event" ? row.event.id : row.key,
        onChange: (_id, row) => {
          if (row.kind === "event") setSelectedId(row.event.id);
        },
      }}
      columns={columns}
      items={rows}
      isNavigable={(row) => row.kind === "event"}
      sortColumnId={sortPreference.columnId}
      sortDirection={sortPreference.direction}
      onHeaderClick={handleHeaderClick}
      headerScrollRef={headerScrollRef}
      scrollRef={scrollRef}
      getItemKey={(row) => row.key}
      onActivate={openDisplayRow}
      renderSectionHeader={renderSectionHeader}
      renderCell={renderCell}
      emptyStateTitle={emptyStateTitle}
      emptyStateHint={emptyStateHint}
      showHorizontalScrollbar={false}
    />
  );
}

export const economicCalendarModule: PluginModule = {
  panes: [{
    id: "econ-calendar",
    name: "Economic Calendar",
    icon: "E",
    component: EconCalendarPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 100, height: 30 },
    tableExport: true,
  }],
  paneTemplates: [{
    id: "econ-calendar-pane",
    paneId: "econ-calendar",
    label: "Economic Calendar",
    description: "Upcoming economic events, releases, and indicators.",
    // "econ" stays a keyword so the old ECON prefix still finds this pane.
    keywords: ["econ", "economic", "calendar", "events", "macro", "releases", "fed", "cpi", "gdp"],
    shortcut: { prefix: "ECO" },
    createInstance: () => ({ placement: "floating" as const }),
  }],
  setup(ctx) {
    ctx.registerChartSeriesCatalog(fredSeriesCatalog);
    attachEconCalendarPersistence(ctx.persistence);
    disposeEconCalendarConnection = registerConnectionSource({
      id: ECON_CALENDAR_CONNECTION_ID,
      name: ECON_CALENDAR_CONNECTION_NAME,
      kind: "api",
      pluginId: "econ",
      authRequired: false,
    });
  },
  dispose() {
    disposeEconCalendarConnection?.();
    disposeEconCalendarConnection = null;
    resetEconCalendarPersistence();
  },
};
