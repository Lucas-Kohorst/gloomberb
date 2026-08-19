import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, ScrollBox, Text, TextAttributes, type InputRenderable } from "../../../ui";
import { useShortcut } from "../../../react/input";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import {
  DataTableStackView,
  EmptyState,
  InputSearchBar,
  Spinner,
  Tabs,
  nextStackSortPreference,
  sortStackItems,
  useUpdatedAgo,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
  type DataTableRootKeyContext,
  type StackSortPreference,
} from "../../../components";
import { colors } from "../../../theme/colors";
import { isPlainKey } from "../../../utils/keyboard";
import { openUrl } from "../../../components/ui/external-link";
import type { PaneProps } from "../../../types/plugin";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { usePaneStatusFooter } from "../shared/pane-footer";
import {
  fetchInternationalClimate,
  fetchMetarObservations,
  fetchPrimaryClimate,
  loadWeatherHourly,
} from "./client";
import { WEATHER_STATIONS, cliProductForStation, findWeatherStation } from "./stations";
import { TWC_KALSHI_URL, WEATHER_PANE_ID, type WeatherHourlyObservation, type WeatherReportStatus, type WeatherScope } from "./types";

type LoadStatus = "idle" | "loading" | "loaded" | "error";
type WeatherSortColumnId = "city" | "station" | "high" | "low" | "now" | "status";

interface WeatherRow {
  id: string;
  city: string;
  stationId: string;
  icao: string;
  scope: WeatherScope;
  high: number | null;
  low: number | null;
  now: number | null;
  precip: number | null;
  status: WeatherReportStatus;
  date: string;
  timezone: string;
}

interface WeatherColumn extends DataTableColumn {
  id: WeatherSortColumnId;
}

function formatTemp(value: number | null): string {
  return value == null ? "—" : `${Math.round(value)}`;
}

function statusLabel(status: WeatherReportStatus): string {
  switch (status) {
    case "official": return "official";
    case "preliminary": return "prelim";
    case "pending": return "pending";
    case "no_report": return "none";
    default: return "—";
  }
}

function statusColor(status: WeatherReportStatus, selected: boolean): string {
  if (selected) return colors.selectedText;
  if (status === "official") return colors.positive;
  if (status === "preliminary" || status === "pending") return colors.warning ?? colors.textMuted;
  if (status === "no_report") return colors.textDim;
  return colors.textMuted;
}

function createColumns(width: number): WeatherColumn[] {
  const stationWidth = 5;
  const highWidth = 5;
  const lowWidth = 5;
  const nowWidth = width >= 42 ? 5 : 0;
  const statusWidth = width >= 52 ? 8 : 0;
  const cityWidth = Math.max(10, width - stationWidth - highWidth - lowWidth - nowWidth - statusWidth - 8);
  return [
    { id: "city", label: "CITY", width: cityWidth, align: "left" },
    { id: "station", label: "STN", width: stationWidth, align: "left" },
    { id: "high", label: "HIGH", width: highWidth, align: "right" },
    { id: "low", label: "LOW", width: lowWidth, align: "right" },
    ...(nowWidth ? [{ id: "now" as const, label: "NOW", width: nowWidth, align: "right" as const }] : []),
    ...(statusWidth ? [{ id: "status" as const, label: "PRINT", width: statusWidth, align: "left" as const }] : []),
  ];
}

function renderWeatherCell(row: WeatherRow, column: WeatherColumn, selected: boolean): DataTableCell {
  const sel = selected ? colors.selectedText : undefined;
  switch (column.id) {
    case "city":
      return { text: row.city, color: sel ?? colors.textBright, attributes: TextAttributes.BOLD };
    case "station":
      return { text: row.stationId, color: sel ?? colors.textDim };
    case "high":
      return { text: formatTemp(row.high), color: sel ?? colors.text };
    case "low":
      return { text: formatTemp(row.low), color: sel ?? colors.text };
    case "now":
      return { text: formatTemp(row.now), color: sel ?? colors.text };
    case "status":
      return { text: statusLabel(row.status), color: statusColor(row.status, selected) };
  }
}

function compareWeatherRows(left: WeatherRow, right: WeatherRow, columnId: WeatherSortColumnId): number {
  switch (columnId) {
    case "city":
      return left.city.localeCompare(right.city);
    case "station":
      return left.stationId.localeCompare(right.stationId);
    case "high":
      return (left.high ?? -Infinity) - (right.high ?? -Infinity);
    case "low":
      return (left.low ?? -Infinity) - (right.low ?? -Infinity);
    case "now":
      return (left.now ?? -Infinity) - (right.now ?? -Infinity);
    case "status":
      return statusLabel(left.status).localeCompare(statusLabel(right.status));
  }
}

function matchesQuery(row: WeatherRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    row.city,
    row.stationId,
    row.icao,
    cliProductForStation(row.stationId),
    row.timezone,
  ].some((value) => value.toLowerCase().includes(needle));
}

function WeatherDetail({
  row,
  hourly,
}: {
  row: WeatherRow;
  hourly: WeatherHourlyObservation[];
}) {
  const recentHourly = hourly.slice(-12).reverse();
  return (
    <ScrollBox flexGrow={1} scrollY>
      <Box flexDirection="column" paddingX={1} gap={1}>
        <Text fg={colors.textDim}>
          {cliProductForStation(row.stationId)} · {row.icao} · {row.timezone}
        </Text>
        <Text fg={colors.text}>
          {row.date ? `${row.date}  ` : ""}
          high {formatTemp(row.high)}°F · low {formatTemp(row.low)}°F
          {row.precip != null ? ` · precip ${row.precip}` : ""}
          {` · ${statusLabel(row.status)}`}
        </Text>
        {row.now != null && (
          <Text fg={colors.textMuted}>Latest hourly {formatTemp(row.now)}°F</Text>
        )}
        {recentHourly.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text fg={colors.textDim}>Hourly</Text>
            {recentHourly.map((obs) => (
              <Text key={`${obs.reportTimeUtc ?? obs.date}-${obs.hourLocal}`} fg={colors.text}>
                {(obs.hourLocal != null ? `${String(obs.hourLocal).padStart(2, "0")}:00` : obs.reportTimeUtc ?? obs.date)
                  + `  ${formatTemp(obs.tempF)}°F`}
              </Text>
            ))}
          </Box>
        )}
        <Text fg={colors.textDim}>Chart with G WX:{row.stationId}:high</Text>
      </Box>
    </ScrollBox>
  );
}

export function WeatherPane({ focused, width, height }: PaneProps) {
  const [scope, setScope] = useState<WeatherScope>("domestic");
  const [rowsByScope, setRowsByScope] = useState<Partial<Record<WeatherScope, WeatherRow[]>>>({});
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [sortPreference, setSortPreference] = useState<StackSortPreference<WeatherSortColumnId>>({
    columnId: "city",
    direction: "asc",
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [hourlyByStation, setHourlyByStation] = useState<Record<string, WeatherHourlyObservation[]>>({});
  const searchInputRef = useRef<InputRenderable | null>(null);
  const genRef = useRef(0);

  const allRows = rowsByScope[scope] ?? [];
  const filteredRows = useMemo(
    () => allRows.filter((row) => matchesQuery(row, searchQuery)),
    [allRows, searchQuery],
  );
  const rows = useMemo(
    () => sortStackItems(filteredRows, sortPreference, compareWeatherRows),
    [filteredRows, sortPreference],
  );
  const selected = rows.find((row) => row.id === selectedId) ?? null;

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((current) => current + 1);
  }, []);
  const blurSearch = useCallback(() => {
    setSearchFocused(false);
  }, []);

  const load = useCallback((nextScope: WeatherScope) => {
    genRef.current += 1;
    const gen = genRef.current;
    setStatus("loading");
    setError(null);
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const yesterdayDate = new Date(now);
    yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
    const yesterday = yesterdayDate.toISOString().slice(0, 10);
    const climate = nextScope === "international"
      ? Promise.all([fetchInternationalClimate(yesterday), fetchInternationalClimate(today)])
      : Promise.all([fetchPrimaryClimate(yesterday), fetchPrimaryClimate(today)]);
    const metar = fetchMetarObservations(nextScope === "international" ? "international" : "primary");
    Promise.all([climate, metar])
      .then(([[previous, current], hourly]) => {
        if (genRef.current !== gen) return;
        const latestByStation = new Map<string, WeatherRow>();
        const seed = WEATHER_STATIONS.filter((station) => station.scope === nextScope);
        for (const station of seed) {
          latestByStation.set(station.id, {
            id: station.id,
            city: station.city,
            stationId: station.id,
            icao: station.icao,
            scope: station.scope,
            high: null,
            low: null,
            now: null,
            precip: null,
            status: "no_report",
            date: "",
            timezone: station.timezone,
          });
        }
        for (const snapshot of [previous, current]) {
          for (const station of snapshot.stations) {
            if (!latestByStation.has(station.id)) {
              latestByStation.set(station.id, {
                id: station.id,
                city: station.city,
                stationId: station.id,
                icao: station.icao,
                scope: station.scope,
                high: null,
                low: null,
                now: null,
                precip: null,
                status: "no_report",
                date: snapshot.date,
                timezone: station.timezone,
              });
            }
          }
          for (const observation of snapshot.observations) {
            const existing = latestByStation.get(observation.stationId);
            const station = findWeatherStation(observation.stationId);
            const nextRow: WeatherRow = {
              id: observation.stationId,
              city: existing?.city ?? station?.city ?? observation.stationId,
              stationId: observation.stationId,
              icao: existing?.icao ?? station?.icao ?? observation.stationId,
              scope: existing?.scope ?? station?.scope ?? nextScope,
              high: observation.maxTemp ?? existing?.high ?? null,
              low: observation.minTemp ?? existing?.low ?? null,
              now: existing?.now ?? null,
              precip: observation.precipitation ?? existing?.precip ?? null,
              status: observation.status,
              date: observation.date || snapshot.date,
              timezone: existing?.timezone ?? station?.timezone ?? "",
            };
            const previousRow = existing;
            const previousHasPrint = previousRow?.high != null || previousRow?.low != null;
            const nextHasPrint = nextRow.high != null || nextRow.low != null;
            if (!previousRow || (nextHasPrint && (!previousHasPrint || nextRow.date >= previousRow.date))) {
              latestByStation.set(observation.stationId, nextRow);
            }
          }
        }
        const latestHourly = new Map<string, number>();
        for (const obs of hourly.observations) {
          if (obs.tempF == null) continue;
          latestHourly.set(obs.stationId, obs.tempF);
        }
        const nextRows = [...latestByStation.values()].map((row) => ({
          ...row,
          now: latestHourly.get(row.stationId) ?? row.now,
        }));
        setRowsByScope((current) => ({ ...current, [nextScope]: nextRows }));
        setStatus("loaded");
        setLastUpdated(Date.now());
      })
      .catch((loadError) => {
        if (genRef.current !== gen) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setStatus("error");
      });
  }, []);

  useEffect(() => {
    load(scope);
  }, [load, scope]);

  useEffect(() => {
    if (rows.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      setDetailOpen(false);
      return;
    }
    if (!selectedId || !rows.some((row) => row.id === selectedId)) {
      setSelectedId(rows[0]!.id);
    }
  }, [rows, selectedId]);

  useEffect(() => {
    if (!detailOpen || !selected) return;
    let cancelled = false;
    loadWeatherHourly(selected.stationId)
      .then((observations) => {
        if (cancelled) return;
        setHourlyByStation((current) => ({ ...current, [selected.stationId]: observations }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [detailOpen, selected]);

  const openSelected = useCallback(() => {
    openUrl(TWC_KALSHI_URL);
  }, []);

  const handleRootKeyDown = useCallback((
    event: DataTableKeyEvent,
    context: DataTableRootKeyContext,
  ) => {
    if (context.selectedIndex <= 0 && isPlainArrowUp(event)) {
      stopSearchFocusNavigation(event);
      focusSearch();
      return true;
    }
    if (event.name === "s" || event.name === "/") {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
      return true;
    }
    if (isPlainKey(event, "r")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      load(scope);
      return true;
    }
    if (isPlainKey(event, "o")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openSelected();
      return true;
    }
    return false;
  }, [focusSearch, load, openSelected, scope]);

  useShortcut((event) => {
    if (!focused || detailOpen || searchFocused) return;
    if (event.name === "s" || event.name === "/") {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
    }
  }, { enabled: focused && !detailOpen && !searchFocused });

  const handleDetailKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (isPlainKey(event, "r")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      load(scope);
      return true;
    }
    if (isPlainKey(event, "o")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openSelected();
      return true;
    }
    return false;
  }, [load, openSelected, scope]);

  const columns = useMemo(() => createColumns(width), [width]);
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  useAutoRefresh(status === "loaded" ? lastUpdated : null, () => load(scope));
  const renderCell = useCallback(
    (row: WeatherRow, column: WeatherColumn, _index: number, rowState: { selected: boolean }) =>
      renderWeatherCell(row, column, rowState.selected),
    [],
  );

  const officialDate = allRows.find((row) => row.status === "official")?.date
    ?? allRows.find((row) => row.date)?.date
    ?? null;

  usePaneStatusFooter({
    registrationId: WEATHER_PANE_ID,
    loading: status === "loading",
    error,
    info: [
      ...(officialDate ? [{ id: "print", parts: [{ text: officialDate, tone: "muted" as const }] }] : []),
      ...(updatedAgo ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }] : []),
    ],
    hints: [
      { id: "search", key: "s", label: "earch", onPress: focusSearch },
      { id: "refresh", key: "r", label: "efresh", onPress: () => load(scope) },
      { id: "open", key: "o", label: "pen", onPress: openSelected },
    ],
  });

  const tabs = (
    <Box height={1} flexShrink={0} overflow="hidden">
      <Tabs
        tabs={[
          { value: "domestic", label: "US" },
          { value: "international", label: "World" },
        ]}
        activeValue={scope}
        onSelect={(value) => {
          setScope(value as WeatherScope);
          setDetailOpen(false);
          setSearchQuery("");
        }}
        compact
        variant="bare"
        focused={focused && !detailOpen && !searchFocused}
      />
    </Box>
  );

  const searchBar = (
    <InputSearchBar
      value={searchQuery}
      focused={focused && !detailOpen}
      active={searchFocused}
      width={width}
      focusToken={searchFocusToken}
      inputRef={searchInputRef}
      placeholder="city or station"
      debounceMs={80}
      onFocus={focusSearch}
      onBlur={blurSearch}
      onNavigateDown={blurSearch}
      onQueryChange={setSearchQuery}
    />
  );

  if (status === "loading" && allRows.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label="Loading weather..." />
        </Box>
      </Box>
    );
  }

  if (error && allRows.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        <Box padding={1}>
          <EmptyState title="Weather unavailable." message={error} hint="Press r to retry." />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      {tabs}
      <DataTableStackView<WeatherRow, WeatherColumn>
        focused={focused && !searchFocused}
        detailOpen={detailOpen && !!selected}
        onBack={() => setDetailOpen(false)}
        detailContent={
          selected ? (
            <WeatherDetail
              row={selected}
              hourly={hourlyByStation[selected.stationId] ?? []}
            />
          ) : null
        }
        detailTitle={selected?.city}
        rootBefore={searchBar}
        onRootKeyDown={handleRootKeyDown}
        onDetailKeyDown={handleDetailKeyDown}
        selection={{
          kind: "id",
          selectedId,
          getId: (row) => row.id,
          onChange: (id) => setSelectedId(id),
        }}
        onActivate={() => {
          blurSearch();
          setDetailOpen(true);
        }}
        rootWidth={width}
        rootHeight={Math.max(1, height - 1)}
        columns={columns}
        items={rows}
        sortColumnId={sortPreference.columnId}
        sortDirection={sortPreference.direction}
        onHeaderClick={(columnId) => {
          const next = columnId as WeatherSortColumnId;
          setSortPreference((current) => nextStackSortPreference(
            current,
            next,
            next === "city" || next === "station" || next === "status" ? "asc" : "desc",
          ));
        }}
        getItemKey={(row) => row.id}
        renderCell={renderCell}
        emptyStateTitle={searchQuery.trim() ? "No matching stations." : "No climate reports."}
        emptyStateHint={searchQuery.trim() ? "Clear search or press r to refresh." : "Press r to refresh."}
      />
    </Box>
  );
}
