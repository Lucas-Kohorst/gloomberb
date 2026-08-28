/** Epoch milliseconds. Evaluators deliberately require callers to provide time. */
export type WeatherTimestamp = number;

export type ThresholdDirection = "above" | "below";
export type ThresholdOperator = "above" | "at_or_above" | "below" | "at_or_below";

export interface WeatherObservation {
  sourceId: string;
  observationId: string;
  observedAt: WeatherTimestamp;
  metric: string;
  value: number;
  status?: "preliminary" | "final";
}

export interface ObservedThresholdCrossingCondition {
  kind: "observed-threshold-crossing";
  metric: string;
  threshold: number;
  direction: ThresholdDirection;
}

export interface StaleSourceCondition {
  kind: "stale-source";
  sourceId: string;
  maxAgeMs: number;
}

export interface PreliminaryToFinalCondition {
  kind: "preliminary-to-final";
  metric?: string;
  sourceId?: string;
}

export interface MarketProbabilityCondition {
  kind: "market-probability";
  marketId: string;
  operator: ThresholdOperator;
  threshold: number;
}

export interface MarketSpreadCondition {
  kind: "market-spread";
  marketId: string;
  operator: ThresholdOperator;
  /** Spread is expressed in basis points, not a fractional probability. */
  thresholdBps: number;
}

export interface SourceDiscrepancyCondition {
  kind: "source-discrepancy";
  metric: string;
  maxDifference: number;
}

export type WeatherAlertCondition =
  | ObservedThresholdCrossingCondition
  | StaleSourceCondition
  | PreliminaryToFinalCondition
  | MarketProbabilityCondition
  | MarketSpreadCondition
  | SourceDiscrepancyCondition;

export interface WeatherAlertEvaluation {
  triggered: boolean;
  evaluatedAt: WeatherTimestamp;
  reason: string;
  sourceIds: string[];
  observationIds: string[];
}

export interface MarketObservation {
  marketId: string;
  sourceId: string;
  observationId: string;
  observedAt: WeatherTimestamp;
  probability?: number;
  spreadBps?: number;
}
