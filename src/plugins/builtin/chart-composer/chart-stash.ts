import type { ChartSpec } from "../../../time-series/types";

const stash = new Map<string, ChartSpec>();

export function stashChartSpec(key: string, spec: ChartSpec): void {
  stash.set(key, spec);
}

export function getStashedChartSpec(key: string): ChartSpec | null {
  return stash.get(key) ?? null;
}
