import type {
  MarketObservation,
  MarketProbabilityCondition,
  MarketSpreadCondition,
  ObservedThresholdCrossingCondition,
  PreliminaryToFinalCondition,
  SourceDiscrepancyCondition,
  StaleSourceCondition,
  ThresholdOperator,
  WeatherAlertEvaluation,
  WeatherObservation,
} from "./types";

function result(
  triggered: boolean,
  evaluatedAt: number,
  reason: string,
  observations: readonly Pick<WeatherObservation, "sourceId" | "observationId">[] = [],
): WeatherAlertEvaluation {
  return {
    triggered,
    evaluatedAt,
    reason,
    sourceIds: [...new Set(observations.map((observation) => observation.sourceId))],
    observationIds: observations.map((observation) => observation.observationId),
  };
}

function validTime(value: number): boolean {
  return Number.isFinite(value);
}

/** Detects a directional crossing, rather than merely being beyond a threshold. */
export function evaluateObservedThresholdCrossing(
  condition: ObservedThresholdCrossingCondition,
  previous: WeatherObservation,
  current: WeatherObservation,
  evaluatedAt: number,
): WeatherAlertEvaluation {
  const comparable =
    previous.metric === condition.metric &&
    current.metric === condition.metric &&
    validTime(previous.observedAt) &&
    validTime(current.observedAt) &&
    current.observedAt > previous.observedAt &&
    Number.isFinite(previous.value) &&
    Number.isFinite(current.value) &&
    Number.isFinite(condition.threshold);
  const crossed = condition.direction === "above"
    ? previous.value <= condition.threshold && current.value > condition.threshold
    : previous.value >= condition.threshold && current.value < condition.threshold;
  return result(
    comparable && crossed,
    evaluatedAt,
    comparable && crossed ? "observed threshold crossed" : "observed threshold not crossed",
    [previous, current],
  );
}

export function evaluateStaleSource(
  condition: StaleSourceCondition,
  latest: Pick<WeatherObservation, "sourceId" | "observationId" | "observedAt">,
  evaluatedAt: number,
): WeatherAlertEvaluation {
  const comparable =
    latest.sourceId === condition.sourceId &&
    validTime(latest.observedAt) &&
    validTime(evaluatedAt) &&
    evaluatedAt >= latest.observedAt &&
    Number.isFinite(condition.maxAgeMs) &&
    condition.maxAgeMs >= 0;
  const triggered = comparable && evaluatedAt - latest.observedAt > condition.maxAgeMs;
  return result(
    triggered,
    evaluatedAt,
    triggered ? "weather source is stale" : "weather source is fresh",
    [latest],
  );
}

export function evaluatePreliminaryToFinal(
  condition: PreliminaryToFinalCondition,
  previous: WeatherObservation,
  current: WeatherObservation,
  evaluatedAt: number,
): WeatherAlertEvaluation {
  const comparable =
    previous.status === "preliminary" &&
    current.status === "final" &&
    previous.sourceId === current.sourceId &&
    (!condition.sourceId || condition.sourceId === current.sourceId) &&
    (!condition.metric || condition.metric === current.metric) &&
    previous.metric === current.metric &&
    current.observedAt >= previous.observedAt;
  return result(
    comparable,
    evaluatedAt,
    comparable ? "observation finalized" : "observation did not transition to final",
    [previous, current],
  );
}

function meets(value: number, operator: ThresholdOperator, threshold: number): boolean {
  switch (operator) {
    case "above": return value > threshold;
    case "at_or_above": return value >= threshold;
    case "below": return value < threshold;
    case "at_or_below": return value <= threshold;
  }
}

export function evaluateMarketProbability(
  condition: MarketProbabilityCondition,
  observation: MarketObservation,
  evaluatedAt: number,
): WeatherAlertEvaluation {
  const valid = observation.marketId === condition.marketId &&
    observation.probability != null &&
    Number.isFinite(observation.probability) &&
    observation.probability >= 0 &&
    observation.probability <= 1 &&
    Number.isFinite(condition.threshold) &&
    validTime(observation.observedAt);
  const triggered = valid && meets(observation.probability!, condition.operator, condition.threshold);
  return {
    triggered,
    evaluatedAt,
    reason: triggered ? "market probability threshold met" : "market probability threshold not met",
    sourceIds: [observation.sourceId],
    observationIds: [observation.observationId],
  };
}

export function evaluateMarketSpread(
  condition: MarketSpreadCondition,
  observation: MarketObservation,
  evaluatedAt: number,
): WeatherAlertEvaluation {
  const valid = observation.marketId === condition.marketId &&
    observation.spreadBps != null &&
    Number.isFinite(observation.spreadBps) &&
    observation.spreadBps >= 0 &&
    Number.isFinite(condition.thresholdBps) &&
    condition.thresholdBps >= 0 &&
    validTime(observation.observedAt);
  const triggered = valid && meets(observation.spreadBps!, condition.operator, condition.thresholdBps);
  return {
    triggered,
    evaluatedAt,
    reason: triggered ? "market spread threshold met" : "market spread threshold not met",
    sourceIds: [observation.sourceId],
    observationIds: [observation.observationId],
  };
}

export function evaluateSourceDiscrepancy(
  condition: SourceDiscrepancyCondition,
  observations: readonly [WeatherObservation, WeatherObservation],
  evaluatedAt: number,
): WeatherAlertEvaluation {
  const [first, second] = observations;
  const comparable = first.metric === condition.metric &&
    second.metric === condition.metric &&
    first.sourceId !== second.sourceId &&
    first.observedAt === second.observedAt &&
    Number.isFinite(first.value) &&
    Number.isFinite(second.value) &&
    Number.isFinite(condition.maxDifference) &&
    condition.maxDifference >= 0;
  const triggered = comparable && Math.abs(first.value - second.value) > condition.maxDifference;
  return result(
    triggered,
    evaluatedAt,
    triggered ? "weather sources disagree" : "weather sources agree",
    observations,
  );
}
