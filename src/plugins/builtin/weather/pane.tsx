import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, ScrollBox, Text, TextAttributes, type InputRenderable } from "../../../ui";
import { useShortcut } from "../../../react/input";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import {
  DataTableStackView,
  DataTableView,
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
import { usePluginState } from "../../runtime";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { useFeedPollInterval } from "../shared/feed-poll-interval";
import { usePaneStatusFooter } from "../shared/pane-footer";
import { useGraphChartPopOut } from "../shared/graph-pop-out";
import {
  EMPTY_WEATHER_ARCHIVE,
  WEATHER_ARCHIVE_SCHEMA_VERSION,
  WEATHER_ARCHIVE_STATE_KEY,
  addUtcDays,
  findWeatherDayRecord,
  mergeWeatherArchive,
  type WeatherArchiveState,
} from "./archive";
import { impliedBackfillJobs, loadImpliedBackfill, officialArchiveObservations } from "./backfill";
import {
  fetchInternationalClimate,
  fetchMetarObservations,
  fetchOfficialClimateHistory,
  fetchPrimaryClimate,
  loadWeatherHourly,
} from "./client";
import { loadKalshiImpliedHighs } from "./kalshi-forecast";
import { kalshiHighSeriesForStation, zonedDateKey } from "./mapping";
import {
  buildWeatherAccuracyReport,
  formatBias,
  formatHitRate,
  type WeatherCityAccuracy,
  type WeatherForecastKind,
} from "./report";
import { WEATHER_STATIONS, cliProductForStation } from "./stations";
import { TWC_KALSHI_URL, WEATHER_PANE_ID, type WeatherDailyObservation, type WeatherDailySnapshot, type WeatherHourlyObservation, type WeatherReportStatus, type WeatherScope } from "./types";

type LoadStatus = "idle" | "loading" | "loaded" | "error";
type WeatherPaneTab = WeatherScope | "report";
type WeatherSortColumnId = "city" | "station" | "high" | "implied" | "yForecast" | "ySettlement" | "low" | "now" | "status";
type ReportSortColumnId = "city" | "hit" | "mae" | "bias" | "samples";

interface WeatherRow {
  id: string;
  city: string;
  stationId: string;
  icao: string;
  scope: WeatherScope;
  high: number | null;
  implied: number | null;
  yForecast: number | null;
  ySettlement: number | null;
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

function formatTemp(value: number | null, decimals = 0): string {
  if (value == null) return "—";
  if (decimals > 0 && !Number.isInteger(value)) return value.toFixed(decimals);
  return `${Math.round(value)}`;
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
  const impliedWidth = width >= 44 ? 5 : 0;
  const yForecastWidth = width >= 62 ? 5 : 0;
  const ySettlementWidth = width >= 54 ? 5 : 0;
  const lowWidth = width >= 72 ? 5 : 0;
  const nowWidth = width >= 80 ? 5 : 0;
  const statusWidth = width >= 90 ? 8 : 0;
  const cityWidth = Math.max(
    10,
    width - stationWidth - highWidth - impliedWidth - yForecastWidth - ySettlementWidth - lowWidth - nowWidth - statusWidth - 8,
  );
  return [
    { id: "city", label: "CITY", width: cityWidth, align: "left" },
    { id: "station", label: "STN", width: stationWidth, align: "left" },
    { id: "high", label: "HIGH", width: highWidth, align: "right" },
    ...(impliedWidth ? [{ id: "implied" as const, label: "IMPL", width: impliedWidth, align: "right" as const }] : []),
    ...(yForecastWidth ? [{ id: "yForecast" as const, label: "Y.FC", width: yForecastWidth, align: "right" as const }] : []),
    ...(ySettlementWidth ? [{ id: "ySettlement" as const, label: "Y.ST", width: ySettlementWidth, align: "right" as const }] : []),
    ...(lowWidth ? [{ id: "low" as const, label: "LOW", width: lowWidth, align: "right" as const }] : []),
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
    case "implied":
      return { text: formatTemp(row.implied, 1), color: sel ?? colors.text };
    case "yForecast":
      return { text: formatTemp(row.yForecast, 1), color: sel ?? colors.text };
    case "ySettlement":
      return { text: formatTemp(row.ySettlement), color: sel ?? colors.text };
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
    case "implied":
      return (left.implied ?? -Infinity) - (right.implied ?? -Infinity);
    case "yForecast":
      return (left.yForecast ?? -Infinity) - (right.yForecast ?? -Infinity);
    case "ySettlement":
      return (left.ySettlement ?? -Infinity) - (right.ySettlement ?? -Infinity);
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
          high {formatTemp(row.high)}°F
          {row.implied != null ? ` · Kalshi ${formatTemp(row.implied, 1)}°F` : ""}
          {` · low ${formatTemp(row.low)}°F`}
          {row.precip != null ? ` · precip ${row.precip}` : ""}
          {` · ${statusLabel(row.status)}`}
        </Text>
        {(row.yForecast != null || row.ySettlement != null) && (
          <Text fg={colors.textMuted}>
            Yesterday forecast {formatTemp(row.yForecast, 1)}°F
            {` · settlement ${formatTemp(row.ySettlement)}°F`}
            {row.yForecast != null && row.ySettlement != null
              ? ` · ${row.ySettlement - row.yForecast >= 0 ? "+" : ""}${(row.ySettlement - row.yForecast).toFixed(1)}`
              : ""}
          </Text>
        )}
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

interface ReportColumn extends DataTableColumn {
  id: ReportSortColumnId;
}

function createReportColumns(width: number): ReportColumn[] {
  const hitWidth = 6;
  const maeWidth = 5;
  const biasWidth = 6;
  const samplesWidth = width >= 48 ? 4 : 0;
  const cityWidth = Math.max(10, width - hitWidth - maeWidth - biasWidth - samplesWidth - 6);
  return [
    { id: "city", label: "CITY", width: cityWidth, align: "left" },
    { id: "hit", label: "HIT", width: hitWidth, align: "right" },
    { id: "mae", label: "MAE", width: maeWidth, align: "right" },
    { id: "bias", label: "BIAS", width: biasWidth, align: "right" },
    ...(samplesWidth ? [{ id: "samples" as const, label: "N", width: samplesWidth, align: "right" as const }] : []),
  ];
}

function compareReportRows(left: WeatherCityAccuracy, right: WeatherCityAccuracy, columnId: ReportSortColumnId): number {
  switch (columnId) {
    case "city":
      return left.city.localeCompare(right.city);
    case "hit":
      return left.hitRate - right.hitRate;
    case "mae":
      return left.mae - right.mae;
    case "bias":
      return left.bias - right.bias;
    case "samples":
      return left.samples - right.samples;
  }
}

function renderReportCell(row: WeatherCityAccuracy, column: ReportColumn, selected: boolean): DataTableCell {
  const sel = selected ? colors.selectedText : undefined;
  switch (column.id) {
    case "city":
      return { text: row.city, color: sel ?? colors.textBright, attributes: TextAttributes.BOLD };
    case "hit":
      return { text: formatHitRate(row.hitRate), color: sel ?? colors.text };
    case "mae":
      return { text: row.mae.toFixed(1), color: sel ?? colors.text };
    case "bias":
      return { text: formatBias(row.bias), color: sel ?? (row.bias > 0 ? colors.negative : row.bias < 0 ? colors.positive : colors.text) };
    case "samples":
      return { text: String(row.samples), color: sel ?? colors.textDim };
  }
}

function emptyWeatherRow(station: {
  id: string;
  city: string;
  icao: string;
  scope: WeatherScope;
  timezone: string;
}, date = ""): WeatherRow {
  return {
    id: station.id,
    city: station.city,
    stationId: station.id,
    icao: station.icao,
    scope: station.scope,
    high: null,
    implied: null,
    yForecast: null,
    ySettlement: null,
    low: null,
    now: null,
    precip: null,
    status: "no_report",
    date,
    timezone: station.timezone,
  };
}

function overlayYesterdayFromArchive(rows: WeatherRow[], archive: WeatherArchiveState, now = Date.now()): WeatherRow[] {
  return rows.map((row) => {
    const localDate = zonedDateKey(row.timezone || "UTC", now);
    const yesterday = addUtcDays(localDate, -1);
    const yday = findWeatherDayRecord(archive, row.stationId, yesterday);
    if (!yday) return row;
    return {
      ...row,
      yForecast: yday.forecastHigh ?? yday.impliedHigh ?? row.yForecast,
      ySettlement: yday.settlementHigh ?? row.ySettlement,
    };
  });
}

function observationOnDate(
  snapshots: readonly WeatherDailySnapshot[],
  stationId: string,
  date: string,
): WeatherDailyObservation | null {
  let found: WeatherDailyObservation | null = null;
  for (const snapshot of snapshots) {
    for (const observation of snapshot.observations) {
      if (observation.stationId === stationId && observation.date === date) found = observation;
    }
  }
  return found;
}

export function WeatherPane({ focused, width, height }: PaneProps) {
  const [tab, setTab] = useState<WeatherPaneTab>("domestic");
  const scope: WeatherScope = tab === "report" ? "domestic" : tab;
  const [archive, setArchive] = usePluginState<WeatherArchiveState>(
    WEATHER_ARCHIVE_STATE_KEY,
    EMPTY_WEATHER_ARCHIVE,
    { schemaVersion: WEATHER_ARCHIVE_SCHEMA_VERSION },
  );
  const [reportKind, setReportKind] = useState<WeatherForecastKind>("implied");
  const [rowsByScope, setRowsByScope] = useState<Partial<Record<WeatherScope, WeatherRow[]>>>({});
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [sortPreference, setSortPreference] = useState<StackSortPreference<WeatherSortColumnId>>({
    columnId: "city",
    direction: "asc",
  });
  const [reportSort, setReportSort] = useState<StackSortPreference<ReportSortColumnId>>({
    columnId: "hit",
    direction: "desc",
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [hourlyByStation, setHourlyByStation] = useState<Record<string, WeatherHourlyObservation[]>>({});
  const [backfillPending, setBackfillPending] = useState(false);
  const [archiveReady, setArchiveReady] = useState(false);
  const searchInputRef = useRef<InputRenderable | null>(null);
  const genRef = useRef(0);
  const archiveRef = useRef(archive);
  archiveRef.current = archive;

  const rawRows = rowsByScope[scope] ?? [];
  const allRows = useMemo(
    () => overlayYesterdayFromArchive(rawRows, archive),
    [archive, rawRows],
  );
  const filteredRows = useMemo(
    () => allRows.filter((row) => matchesQuery(row, searchQuery)),
    [allRows, searchQuery],
  );
  const rows = useMemo(
    () => sortStackItems(filteredRows, sortPreference, compareWeatherRows),
    [filteredRows, sortPreference],
  );
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const report = useMemo(() => buildWeatherAccuracyReport(archive, reportKind), [archive, reportKind]);
  const reportRows = useMemo(
    () => sortStackItems(report.cities, reportSort, compareReportRows),
    [report.cities, reportSort],
  );

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
    const now = Date.now();
    const utcToday = new Date(now).toISOString().slice(0, 10);
    const utcYesterday = addUtcDays(utcToday, -1);
    const utcTomorrow = addUtcDays(utcToday, 1);
    const climateDates = nextScope === "international"
      ? [utcYesterday, utcToday, utcTomorrow]
      : [utcYesterday, utcToday];
    const climate = Promise.all(climateDates.map((date) => (
      nextScope === "international" ? fetchInternationalClimate(date) : fetchPrimaryClimate(date)
    )));
    const metar = fetchMetarObservations(nextScope === "international" ? "international" : "primary");
    climate
      .then(async (snapshots) => {
        if (genRef.current !== gen) return;
        const latestByStation = new Map<string, WeatherRow>();
        const seed = WEATHER_STATIONS.filter((station) => station.scope === nextScope);
        const applyStation = (
          station: { id: string; city: string; icao: string; scope: WeatherScope; timezone: string },
        ) => {
          const localDate = zonedDateKey(station.timezone || "UTC", now);
          const todayObs = observationOnDate(snapshots, station.id, localDate);
          latestByStation.set(station.id, {
            ...emptyWeatherRow(station, localDate),
            high: todayObs?.maxTemp ?? null,
            low: todayObs?.minTemp ?? null,
            precip: todayObs?.precipitation ?? null,
            status: todayObs?.status ?? "no_report",
            date: todayObs?.date || localDate,
          });
        };
        for (const station of seed) applyStation(station);
        for (const snapshot of snapshots) {
          for (const station of snapshot.stations) {
            if (!latestByStation.has(station.id)) applyStation(station);
          }
        }
        const baseRows = [...latestByStation.values()];
        const observations = snapshots.flatMap((snapshot) => (
          snapshot.observations.map((row) => ({
            stationId: row.stationId,
            date: row.date || snapshot.date,
            high: row.maxTemp,
            official: row.official || row.status === "official",
          }))
        ));
        const nextArchive = mergeWeatherArchive(archiveRef.current, {
          observations,
          now,
          today: utcToday,
        });
        setArchive((current) => mergeWeatherArchive(current, {
          observations,
          now,
          today: utcToday,
        }));
        const withYesterday = overlayYesterdayFromArchive(baseRows, nextArchive, now);
        setRowsByScope((current) => ({ ...current, [nextScope]: withYesterday }));
        setStatus("loaded");
        setArchiveReady(true);
        setLastUpdated(Date.now());

        const hourly = await metar.catch(() => ({ observations: [] as WeatherHourlyObservation[] }));
        if (genRef.current !== gen) return;
        const latestHourly = new Map<string, number>();
        for (const obs of hourly.observations) {
          if (obs.tempF == null) continue;
          latestHourly.set(obs.stationId, obs.tempF);
        }
        const withNow = baseRows.map((row) => ({
          ...row,
          now: latestHourly.get(row.stationId) ?? row.now,
        }));
        setRowsByScope((current) => ({
          ...current,
          [nextScope]: overlayYesterdayFromArchive(withNow, archiveRef.current, now),
        }));

        const impliedByDate = new Map<string, string[]>();
        for (const row of baseRows) {
          if (!kalshiHighSeriesForStation(row.stationId)) continue;
          const date = zonedDateKey(row.timezone || "UTC", now);
          const list = impliedByDate.get(date);
          if (list) list.push(row.stationId);
          else impliedByDate.set(date, [row.stationId]);
        }
        const implied = (await Promise.all(
          [...impliedByDate.entries()].map(([date, stationIds]) => (
            loadKalshiImpliedHighs(stationIds, date, now).catch(() => [])
          )),
        )).flat();
        if (genRef.current !== gen) return;
        const impliedArchive = mergeWeatherArchive(archiveRef.current, {
          implied,
          now,
          today: utcToday,
        });
        setArchive((current) => mergeWeatherArchive(current, {
          implied,
          now,
          today: utcToday,
        }));
        const impliedByStation = new Map(implied.map((row) => [row.stationId, row] as const));
        const nextRows = overlayYesterdayFromArchive(withNow, impliedArchive, now).map((row) => ({
          ...row,
          implied: impliedByStation.get(row.stationId)?.impliedHigh
            ?? findWeatherDayRecord(impliedArchive, row.stationId, zonedDateKey(row.timezone || "UTC", now))?.impliedHigh
            ?? null,
        }));
        setRowsByScope((current) => ({ ...current, [nextScope]: nextRows }));
      })
      .catch((loadError) => {
        if (genRef.current !== gen) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setStatus("error");
      });
  }, [setArchive]);

  useEffect(() => {
    load(scope);
  }, [load, scope]);

  useEffect(() => {
    if (!archiveReady) return;
    let cancelled = false;
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    void (async () => {
      const history = await fetchOfficialClimateHistory(undefined, now, ["primary"]).catch(() => []);
      if (cancelled) return;
      if (history.length > 0) {
        setArchive((current) => mergeWeatherArchive(current, {
          observations: officialArchiveObservations(history),
          now,
          today,
        }));
      }
      const jobs = impliedBackfillJobs(archiveRef.current, today);
      if (jobs.length === 0) return;
      setBackfillPending(true);
      await loadImpliedBackfill(jobs, {
        isCancelled: () => cancelled,
        onBatch: (rows) => {
          if (cancelled || rows.length === 0) return;
          setArchive((current) => mergeWeatherArchive(current, {
            implied: rows,
            now,
            today,
          }));
        },
      });
      if (!cancelled) setBackfillPending(false);
    })().catch(() => {
      if (!cancelled) setBackfillPending(false);
    });
    return () => {
      cancelled = true;
    };
  }, [archiveReady, setArchive]);

  useEffect(() => {
    if (tab !== "international" || status !== "loaded") return;
    let cancelled = false;
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    void fetchOfficialClimateHistory(undefined, now, ["international"]).then((history) => {
      if (cancelled || history.length === 0) return;
      setArchive((current) => mergeWeatherArchive(current, {
        observations: officialArchiveObservations(history),
        now,
        today,
      }));
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [setArchive, status, tab]);

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
  const popOutChart = useGraphChartPopOut();
  const graphSelected = useCallback(() => {
    if (!selected) return;
    popOutChart(`WX:${selected.stationId}:high`);
  }, [popOutChart, selected]);

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
    if (isPlainKey(event, "g") && selected) {
      event.preventDefault?.();
      event.stopPropagation?.();
      graphSelected();
      return true;
    }
    if (isPlainKey(event, "o")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openSelected();
      return true;
    }
    if (tab === "report" && isPlainKey(event, "k")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      setReportKind((current) => current === "twc" ? "implied" : "twc");
      return true;
    }
    return false;
  }, [focusSearch, graphSelected, load, openSelected, scope, selected, tab]);

  useShortcut((event) => {
    if (!focused || detailOpen || searchFocused) return;
    if (event.name === "s" || event.name === "/") {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
    }
    if (tab === "report" && event.name === "k") {
      event.preventDefault?.();
      event.stopPropagation?.();
      setReportKind((current) => current === "twc" ? "implied" : "twc");
    }
  }, { enabled: focused && !detailOpen && !searchFocused });

  const handleDetailKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (isPlainKey(event, "r")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      load(scope);
      return true;
    }
    if (isPlainKey(event, "g") && selected) {
      event.preventDefault?.();
      event.stopPropagation?.();
      graphSelected();
      return true;
    }
    if (isPlainKey(event, "o")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openSelected();
      return true;
    }
    return false;
  }, [graphSelected, load, openSelected, scope, selected]);

  const columns = useMemo(() => createColumns(width), [width]);
  const reportColumns = useMemo(() => createReportColumns(width), [width]);
  const filteredReportRows = useMemo(
    () => reportRows.filter((row) => {
      const needle = searchQuery.trim().toLowerCase();
      if (!needle) return true;
      return row.city.toLowerCase().includes(needle) || row.stationId.toLowerCase().includes(needle);
    }),
    [reportRows, searchQuery],
  );
  const renderReport = useCallback(
    (row: WeatherCityAccuracy, column: ReportColumn, _index: number, rowState: { selected: boolean }) =>
      renderReportCell(row, column, rowState.selected),
    [],
  );
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  const poll = useFeedPollInterval();
  useAutoRefresh(status === "loaded" ? lastUpdated : null, () => load(scope), poll.intervalMinutes);
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
      ...(tab === "report" && report.samples > 0
        ? [{ id: "hit", parts: [{ text: `${formatHitRate(report.hitRate)} on ${reportKind === "implied" ? "Kalshi" : "TWC"} fcst`, tone: "muted" as const }] }]
        : []),
      ...(tab === "report" && report.samples > 0
        ? [{ id: "bias", parts: [{ text: `bias ${formatBias(report.bias)}`, tone: "muted" as const }] }]
        : []),
      ...(tab !== "report" && officialDate ? [{ id: "print", parts: [{ text: officialDate, tone: "muted" as const }] }] : []),
      ...(backfillPending ? [{ id: "backfill", parts: [{ text: "backfilling Y.FC", tone: "muted" as const }] }] : []),
      ...(updatedAgo ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }] : []),
    ],
    trailingInfo: [poll.segment],
    hints: [
      ...(tab !== "report" && selected
        ? [{ id: "graph", key: "g", label: "raph", onPress: graphSelected }]
        : []),
      ...(tab === "report"
        ? [{ id: "kind", key: "k", label: reportKind === "twc" ? "alshi implied" : " TWC forecast", onPress: () => setReportKind((current) => current === "twc" ? "implied" : "twc") }]
        : (!detailOpen ? [{ id: "search", key: "/", label: "search", onPress: focusSearch }] : [])),
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
          { value: "report", label: "30d" },
        ]}
        activeValue={tab}
        onSelect={(value) => {
          setTab(value as WeatherPaneTab);
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

  if (status === "loading" && allRows.length === 0 && tab !== "report") {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label="Loading weather..." />
        </Box>
      </Box>
    );
  }

  if (error && allRows.length === 0 && tab !== "report") {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        <Box padding={1}>
          <EmptyState title="Weather unavailable." message={error} hint="Press r to retry." />
        </Box>
      </Box>
    );
  }

  if (tab === "report") {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        <DataTableView<WeatherCityAccuracy, ReportColumn>
          focused={focused}
          rootWidth={width}
          rootHeight={Math.max(1, height - 1)}
          selection={{
            kind: "id",
            selectedId,
            getId: (row) => row.stationId,
            onChange: (id) => setSelectedId(id),
          }}
          columns={reportColumns}
          items={filteredReportRows}
          sortColumnId={reportSort.columnId}
          sortDirection={reportSort.direction}
          onHeaderClick={(columnId) => {
            const next = columnId as ReportSortColumnId;
            setReportSort((current) => nextStackSortPreference(
              current,
              next,
              next === "city" ? "asc" : "desc",
            ));
          }}
          getItemKey={(row) => row.stationId}
          renderCell={renderReport}
          emptyStateTitle={report.samples === 0 ? "No stored forecast days yet." : "No matching cities."}
          emptyStateHint="Kalshi Y.FC is implied at local midnight vs official print. TWC HIGH freezes on first visit."
        />
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
