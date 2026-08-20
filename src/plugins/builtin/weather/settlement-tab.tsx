import { useEffect, useMemo, useState } from "react";
import { Box, ScrollBox, Text, TextAttributes } from "../../../ui";
import { EmptyState } from "../../../components";
import { colors } from "../../../theme/colors";
import type { PredictionMarketSummary } from "../../prediction-markets/types";
import { loadKalshiImpliedHigh } from "./kalshi-forecast";
import { loadWeatherHourly, loadWeatherObservation } from "./client";
import { resolveWeatherSettlement, weatherMetricLabel } from "./mapping";
import { cliProductForStation, findWeatherStation } from "./stations";
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
        <EmptyState title="No Weather Company settlement for this market." />
      </Box>
    );
  }

  const station = findWeatherStation(settlement.stationId);
  const matchedHour = settlement.hour != null
    ? hourly.find((row) => row.hourLocal === settlement.hour)
    : null;
  const lineWidth = Math.max(12, width - 2);

  return (
    <ScrollBox flexGrow={1} scrollY>
      <Box flexDirection="column" paddingX={1} gap={1}>
        <Text fg={colors.textDim} width={lineWidth}>
          {cliProductForStation(settlement.stationId)}
          {station ? ` · ${station.icao}` : ""}
          {` · ${settlement.date}`}
        </Text>
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
