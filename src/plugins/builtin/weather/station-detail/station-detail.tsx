import { useMemo, useState } from "react";
import { Box, Text, TextAttributes } from "../../../../ui";
import {
  DataTableView,
  type DataTableCell,
  type DataTableColumn,
} from "../../../../components";
import { colors, priceColor } from "../../../../theme/colors";
import {
  applySortPreference,
  nextSortPreference,
  type SortComparableValue,
  type SortPreference,
} from "../../../../utils/sort-values";

export interface StationObservation {
  /** An ISO-8601 timestamp supplied by the station feed. */
  timestamp: string | null;
  temperatureF?: number | null;
  dewpointF?: number | null;
  humidityPct?: number | null;
  windDirection?: string | null;
  windSpeedMph?: number | null;
  windGustMph?: number | null;
  visibilityMiles?: number | null;
  pressureInHg?: number | null;
  precipitationIn?: number | null;
  skyCondition?: string | null;
  status?: string | null;
}

export interface StationDetailProps {
  observations: readonly StationObservation[];
  /** Optional station metadata; the containing detail stack can supply its own title. */
  stationLabel?: string;
  timeZone?: string;
  width?: number;
  height?: number;
}

type TrendField = "temperatureF" | "dewpointF" | "humidityPct" | "pressureInHg";

function validNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formattedNumber(value: number | null | undefined, decimals = 0): string {
  if (!validNumber(value)) return "—";
  return decimals > 0 ? value.toFixed(decimals) : String(Math.round(value));
}

function formatTimestamp(timestamp: string | null, timeZone?: string): string {
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return timestamp;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "UTC",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(date).replace(",", "");
  } catch {
    return timestamp;
  }
}

function timeZoneLabel(timeZone?: string): string {
  if (!timeZone) return "UTC";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "short",
    }).formatToParts(new Date());
    return parts.find((part) => part.type === "timeZoneName")?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

function formatWind(observation: StationObservation): string {
  const speed = validNumber(observation.windSpeedMph) ? `${Math.round(observation.windSpeedMph)}` : "—";
  const gust = validNumber(observation.windGustMph) ? `G${Math.round(observation.windGustMph)}` : "";
  const direction = observation.windDirection?.trim();
  return [direction, speed === "—" && !direction ? "—" : speed, gust].filter(Boolean).join(" ");
}

function sortNewestFirst(observations: readonly StationObservation[]): StationObservation[] {
  return observations
    .map((observation, index) => ({ observation, index, timestamp: Date.parse(observation.timestamp ?? "") }))
    .sort((left, right) => {
      const leftValid = Number.isFinite(left.timestamp);
      const rightValid = Number.isFinite(right.timestamp);
      if (leftValid && rightValid) return right.timestamp - left.timestamp;
      if (leftValid) return -1;
      if (rightValid) return 1;
      return left.index - right.index;
    })
    .map(({ observation }) => observation);
}

function trendFor(observations: readonly StationObservation[], field: TrendField, unit: string, decimals = 0): string | null {
  const values = observations.filter((observation) => validNumber(observation[field]));
  if (values.length < 2) return null;
  const newest = values[0]![field] as number;
  const oldest = values[values.length - 1]![field] as number;
  const delta = newest - oldest;
  if (Math.abs(delta) < (decimals ? 0.05 : 0.5)) return `${unit} steady`;
  return `${unit} ${delta > 0 ? "+" : ""}${formattedNumber(delta, decimals)}${unit === "RH" ? " pp" : unit === "Pressure" ? " inHg" : "°F"}`;
}

/** A short, data-derived sentence suitable for a detail view, not a chart replacement. */
export function stationTrendSummary(observations: readonly StationObservation[]): string {
  const newestFirst = sortNewestFirst(observations);
  if (newestFirst.length === 0) return "No observation trend available.";
  const trends = [
    trendFor(newestFirst, "temperatureF", "Temp"),
    trendFor(newestFirst, "dewpointF", "Dew"),
    trendFor(newestFirst, "humidityPct", "RH"),
    trendFor(newestFirst, "pressureInHg", "Pressure", 2),
  ].filter((trend): trend is string => trend != null);
  return trends.length > 0
    ? `${trends.join(" · ")} across ${newestFirst.length} observations`
    : "Insufficient readings for a trend.";
}

function CurrentConditions({ observation, timeZone }: {
  observation: StationObservation | undefined;
  timeZone?: string;
}) {
  if (!observation) {
    return <Text fg={colors.textDim}>No current station observation.</Text>;
  }
  const tempDelta = validNumber(observation.temperatureF) && validNumber(observation.dewpointF)
    ? observation.temperatureF - observation.dewpointF
    : null;
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={2}>
        <Text fg={colors.textDim}>AS OF ({timeZoneLabel(timeZone)})</Text>
        <Text fg={colors.text}>{formatTimestamp(observation.timestamp, timeZone)}</Text>
        {observation.status && <Text fg={colors.textMuted}>{observation.status}</Text>}
      </Box>
      <Box flexDirection="row" gap={3} flexWrap="wrap">
        <Box flexDirection="row" gap={1}>
          <Text fg={colors.textDim}>TEMP</Text>
          <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{formattedNumber(observation.temperatureF)}°F</Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text fg={colors.textDim}>DEW</Text>
          <Text fg={colors.text}>{formattedNumber(observation.dewpointF)}°F</Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text fg={colors.textDim}>RH</Text>
          <Text fg={colors.text}>{formattedNumber(observation.humidityPct)}%</Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text fg={colors.textDim}>WIND</Text>
          <Text fg={colors.text}>{formatWind(observation)}</Text>
        </Box>
      </Box>
      <Text fg={colors.textMuted}>
        {observation.skyCondition?.trim() || "Sky condition unavailable"}
        {tempDelta != null ? ` · spread ${formattedNumber(tempDelta)}°F` : ""}
        {validNumber(observation.visibilityMiles) ? ` · vis ${formattedNumber(observation.visibilityMiles, 1)} mi` : ""}
        {validNumber(observation.pressureInHg) ? ` · ${formattedNumber(observation.pressureInHg, 2)} inHg` : ""}
        {validNumber(observation.precipitationIn) ? ` · precip ${formattedNumber(observation.precipitationIn, 2)} in` : ""}
      </Text>
    </Box>
  );
}

type StationObservationColumnId = "local" | "temp" | "dew" | "humidity" | "wind" | "visibility" | "pressure" | "status";

interface StationObservationRow extends StationObservation {
  id: string;
}

interface StationObservationColumn extends DataTableColumn {
  id: StationObservationColumnId;
}

function observationColumnValue(
  row: StationObservationRow,
  columnId: StationObservationColumnId,
): SortComparableValue {
  switch (columnId) {
    case "local": return row.timestamp;
    case "temp": return row.temperatureF ?? null;
    case "dew": return row.dewpointF ?? null;
    case "humidity": return row.humidityPct ?? null;
    case "wind": return row.windSpeedMph ?? null;
    case "visibility": return row.visibilityMiles ?? null;
    case "pressure": return row.pressureInHg ?? null;
    case "status": return `${row.skyCondition ?? ""} ${row.status ?? ""}`;
  }
}

function ObservationTable({ observations, timeZone, width }: {
  observations: readonly StationObservation[];
  timeZone?: string;
  width: number;
}) {
  const compact = width < 70;
  const narrow = width < 52;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortPreference<StationObservationColumnId>>({
    columnId: "local",
    direction: "desc",
  });
  const rows = useMemo<StationObservationRow[]>(
    () => observations.map((observation, index) => ({
      ...observation,
      id: `${observation.timestamp ?? "unknown"}-${index}`,
    })),
    [observations],
  );
  const sortedRows = useMemo(
    () => applySortPreference(rows, sort, observationColumnValue),
    [rows, sort],
  );
  const columns = useMemo<StationObservationColumn[]>(() => [
    { id: "local", label: `LOCAL (${timeZoneLabel(timeZone)})`, width: 12, align: "left" },
    { id: "temp", label: "TEMP", width: 6, align: "right" },
    ...(!narrow ? [{ id: "dew" as const, label: "DEW", width: 6, align: "right" as const }] : []),
    { id: "humidity", label: "RH", width: 5, align: "right" },
    { id: "wind", label: "WIND", width: compact ? 11 : 13, align: "left" },
    ...(!compact ? [
      { id: "visibility" as const, label: "VIS", width: 6, align: "right" as const },
      { id: "pressure" as const, label: "PRES", width: 7, align: "right" as const },
    ] : []),
    { id: "status", label: "SKY / STATUS", width: Math.max(12, width - (compact ? 43 : 57)), align: "left" },
  ], [compact, narrow, width]);

  return (
    <DataTableView<StationObservationRow, StationObservationColumn>
      focused={false}
      rootWidth={width}
      rootHeight={Math.max(5, Math.min(rows.length + 1, 18))}
      selection={{
        kind: "id",
        selectedId,
        getId: (row) => row.id,
        onChange: setSelectedId,
      }}
      columns={columns}
      items={sortedRows}
      sortColumnId={sort.columnId}
      sortDirection={sort.direction}
      onHeaderClick={(columnId) => setSort((current) => nextSortPreference(current, columnId as StationObservationColumnId))}
      getItemKey={(row) => row.id}
      emptyStateTitle="No station observations."
      renderCell={(row, column): DataTableCell => {
        switch (column.id) {
          case "local": return { text: formatTimestamp(row.timestamp, timeZone), color: colors.textMuted };
          case "temp": return { text: `${formattedNumber(row.temperatureF)}°`, color: colors.text };
          case "dew": return { text: `${formattedNumber(row.dewpointF)}°`, color: colors.text };
          case "humidity": return { text: `${formattedNumber(row.humidityPct)}%`, color: colors.text };
          case "wind": return { text: formatWind(row), color: colors.text };
          case "visibility": return { text: formattedNumber(row.visibilityMiles, 1), color: colors.text };
          case "pressure": return { text: formattedNumber(row.pressureInHg, 2), color: colors.text };
          case "status": return {
            text: [row.skyCondition, row.status].filter(Boolean).join(" · ") || "—",
            color: row.status ? priceColor(row.status.toLowerCase().includes("clear") ? 1 : 0) : colors.textMuted,
          };
        }
      }}
    />
  );
}

/** Presentational station detail for an already-loaded weather.gov observation series. */
export function StationDetail({
  observations,
  stationLabel,
  timeZone,
  width = 80,
  height,
}: StationDetailProps) {
  const newestFirst = useMemo(() => sortNewestFirst(observations), [observations]);
  const trend = useMemo(() => stationTrendSummary(newestFirst), [newestFirst]);

  return (
    <Box flexDirection="column" width={width} height={height} paddingX={1} gap={1}>
      {stationLabel && <Text fg={colors.textDim}>{stationLabel}</Text>}
      <CurrentConditions observation={newestFirst[0]} timeZone={timeZone} />
      <Text fg={colors.textMuted}>TREND · {trend}</Text>
      <ObservationTable observations={newestFirst} timeZone={timeZone} width={width} />
    </Box>
  );
}
