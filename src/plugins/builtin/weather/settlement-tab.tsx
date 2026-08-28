import { useEffect, useMemo, useState } from "react";
import { Box, ScrollBox, Text, TextAttributes } from "../../../ui";
import { EmptyState } from "../../../components";
import { ExternalLinkText } from "../../../components/ui/external-link";
import { colors } from "../../../theme/colors";
import type { PredictionMarketSummary } from "../../prediction-markets/types";
import { loadKalshiImpliedHigh } from "./kalshi-forecast";
import { loadWeatherHourly, loadWeatherObservation } from "./client";
import { resolveWeatherSettlement, weatherMetricLabel } from "./mapping";
import { findWeatherStation } from "./stations";
import type { WeatherDailyObservation, WeatherHourlyObservation } from "./types";

function formatTemp(value: number | null | undefined): string {
  return value == null ? "—" : `${Math.round(value)}°F`;
}

function observationForMetric(
  observation: WeatherDailyObservation | null,
  metric: "high" | "low" | "precip" | "hourly",
): string {
  if (!observation) return "—";
  if (metric === "low") return formatTemp(observation.minTemp);
  if (metric === "precip") {
    return observation.precipitation == null ? "—" : String(observation.precipitation);
  }
  return formatTemp(observation.maxTemp);
}

export function weatherSettlementStatusExplanation(
  status: WeatherDailyObservation["status"] | null | undefined,
): string {
  switch (status) {
    case "official": return "official — final Weather Company CLI print";
    case "preliminary": return "preliminary — may still be revised";
    case "pending": return "pending — final authority print is not available";
    case "no_report": return "no report — authority published no value";
    default: return "unknown — authority status is unavailable";
  }
}

export function weatherReportTimestamp(
  reportTimeUtc: string | null | undefined,
  timeZone: string,
): string | null {
  if (!reportTimeUtc) return null;
  const timestamp = new Date(reportTimeUtc);
  if (!Number.isFinite(timestamp.getTime())) return reportTimeUtc;
  const local = new Intl.DateTimeFormat("en-US", {
    timeZone,
    dateStyle: "short",
    timeStyle: "short",
    hour12: false,
  }).format(timestamp);
  return `${reportTimeUtc} UTC (${local} ${timeZone} local)`;
}

export function isPredictionWeatherSettlement(
  summary: Pick<
    PredictionMarketSummary,
    | "venue"
    | "seriesTicker"
    | "eventTicker"
    | "marketId"
    | "category"
    | "title"
    | "description"
    | "rulesPrimary"
    | "rulesSecondary"
    | "resolutionSource"
  >,
): boolean {
  return resolveWeatherSettlement({
    venue: summary.venue,
    seriesTicker: summary.seriesTicker,
    eventTicker: summary.eventTicker,
    marketId: summary.marketId,
    category: summary.category,
    title: summary.title,
    description: summary.description,
    rulesPrimary: summary.rulesPrimary,
    rulesSecondary: summary.rulesSecondary,
    resolutionSource: summary.resolutionSource,
  }) != null;
}

export function PredictionWeatherSettlementTab({
  summary,
  width,
}: {
  summary: PredictionMarketSummary;
  width: number;
}) {
  const settlement = useMemo(
    () => resolveWeatherSettlement({
      venue: summary.venue,
      seriesTicker: summary.seriesTicker,
      eventTicker: summary.eventTicker,
      marketId: summary.marketId,
      category: summary.category,
      title: summary.title,
      description: summary.description,
      rulesPrimary: summary.rulesPrimary,
      rulesSecondary: summary.rulesSecondary,
      resolutionSource: summary.resolutionSource,
    }),
    [summary],
  );
  const [observation, setObservation] = useState<WeatherDailyObservation | null>(null);
  const [hourly, setHourly] = useState<WeatherHourlyObservation[]>([]);
  const [implied, setImplied] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!settlement) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setImplied(null);
    const daily = loadWeatherObservation(settlement.stationId, settlement.date);
    const hours = settlement.metric === "hourly"
      ? loadWeatherHourly(settlement.stationId)
      : Promise.resolve([] as WeatherHourlyObservation[]);
    const kalshi = settlement.metric === "high"
      ? loadKalshiImpliedHigh(settlement.stationId, settlement.date).catch(() => null)
      : Promise.resolve(null);
    Promise.all([daily, hours, kalshi])
      .then(([nextObservation, nextHourly, nextImplied]) => {
        if (cancelled) return;
        setObservation(nextObservation);
        setHourly(nextHourly.filter((row) => !settlement.date || row.date === settlement.date));
        setImplied(nextImplied?.impliedHigh ?? null);
        setLoading(false);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [settlement]);

  if (!settlement) {
    return (
      <Box flexGrow={1} justifyContent="center">
        <EmptyState
          title="No Weather Company settlement for this market."
          message={`Could not map ${summary.eventTicker ?? summary.marketId ?? "this market"} to a known station, date, and metric.`}
          hint="Only Kalshi weather markets with a recognized CLI or station ticker are supported."
        />
      </Box>
    );
  }

  const station = findWeatherStation(settlement.stationId);
  const matchedHour = settlement.hour != null
    ? hourly.find((row) => row.hourLocal === settlement.hour)
    : null;
  const latestHourly = hourly[hourly.length - 1];
  const lineWidth = Math.max(12, width - 2);

  return (
    <ScrollBox flexGrow={1} scrollY>
      <Box flexDirection="column" paddingX={1} gap={1}>
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={colors.border}
          paddingX={1}
          width={lineWidth}
        >
          <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>Settlement provenance</Text>
          <Text fg={colors.text}>Authority · Weather Company {settlement.cliProduct}</Text>
          <Text fg={colors.textDim}>
            Station · {settlement.cliProduct}
            {station ? ` · ${station.city} · ${station.icao}` : ""}
          </Text>
          <Text fg={colors.textDim}>
            Date · {settlement.date} local ({station?.timezone ?? "timezone unavailable"})
          </Text>
          {observation ? (
            <Text fg={observation.official ? colors.positive : colors.warning}>
              Status · {weatherSettlementStatusExplanation(observation.status)}
            </Text>
          ) : (
            <Text fg={colors.textDim}>
              Status · {loading ? "waiting for the authority print" : "authority print unavailable"}
            </Text>
          )}
          {settlement.metric === "hourly" && (matchedHour ?? latestHourly)?.reportTimeUtc && (
            <Text fg={colors.textDim}>
              Reported · {weatherReportTimestamp(
                (matchedHour ?? latestHourly)?.reportTimeUtc,
                station?.timezone ?? "UTC",
              )}
            </Text>
          )}
          <Text fg={colors.textDim}>
            Source · <ExternalLinkText url={settlement.settlementUrl} label="Weather Company settlement page" />
          </Text>
          <Text fg={colors.textMuted}>
            Cross-check · {settlement.metric === "hourly"
              ? "METAR hourly observations; not the settlement authority"
              : "Kalshi implied value; informational only"}
          </Text>
        </Box>
        {loading ? (
          <Text fg={colors.textDim}>loading settlement print</Text>
        ) : error ? (
          <Text fg={colors.negative}>{error}</Text>
        ) : settlement.metric === "hourly" ? (
          <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
            {matchedHour
              ? `${weatherMetricLabel(settlement.metric)} ${formatTemp(matchedHour.tempF)}`
              : `${weatherMetricLabel(settlement.metric)} ${hourly.length === 0 ? "—" : formatTemp(hourly[hourly.length - 1]?.tempF ?? null)}`}
          </Text>
        ) : (
          <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
            {weatherMetricLabel(settlement.metric)} {observationForMetric(observation, settlement.metric)}
          </Text>
        )}
        {observation && settlement.metric !== "hourly" && (
          <Text fg={colors.textMuted}>
            {observation.status}
            {observation.maxTemp != null ? ` · high ${formatTemp(observation.maxTemp)}` : ""}
            {observation.minTemp != null ? ` · low ${formatTemp(observation.minTemp)}` : ""}
          </Text>
        )}
        {implied != null && settlement.metric === "high" && (
          <Text fg={colors.text}>
            Kalshi implied {implied.toFixed(1)}°F
            {observation?.maxTemp != null
              ? ` · vs print ${observation.maxTemp - implied >= 0 ? "+" : ""}${(observation.maxTemp - implied).toFixed(1)}`
              : ""}
          </Text>
        )}
        {settlement.hour != null && settlement.metric === "hourly" && (
          <Text fg={colors.textDim}>Market hour {String(settlement.hour).padStart(2, "0")}:00</Text>
        )}
        {hourly.length > 0 && settlement.metric === "hourly" && hourly.slice(-8).reverse().map((row) => (
          <Text key={`${row.reportTimeUtc}-${row.hourLocal}`} fg={colors.text}>
            {(row.hourLocal != null ? `${String(row.hourLocal).padStart(2, "0")}:00` : row.date)
              + `  ${formatTemp(row.tempF)}`}
          </Text>
        ))}
      </Box>
    </ScrollBox>
  );
}
