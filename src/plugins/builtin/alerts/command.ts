import type { AlertCondition } from "./types";
import { normalizeAlertSymbol } from "./quotes";

export interface AlertCommandInput {
  symbol: string;
  condition: AlertCondition;
  price: number;
}

export interface WeatherAlertCommandInput {
  stationId: string;
  condition: "observed-threshold-crossing" | "stale-source" | "preliminary-to-final" | "source-discrepancy";
  metric?: "high" | "low" | "precip" | "hourly";
  target?: number;
}

export function parseWeatherAlertCommandValues(values?: Record<string, string>): WeatherAlertCommandInput | null {
  const stationId = values?.station?.trim().toUpperCase();
  const condition = values?.condition;
  const metric = values?.metric?.trim().toLowerCase();
  const validMetric = metric === "high" || metric === "low" || metric === "precip" || metric === "hourly";
  if (!stationId || !condition) return null;
  if (condition === "final") {
    return validMetric ? { stationId, condition: "preliminary-to-final", metric } : null;
  }
  const target = Number(values?.target);
  if (!Number.isFinite(target) || target < 0) return null;
  if (condition === "above" || condition === "below") {
    return validMetric ? { stationId, condition: "observed-threshold-crossing", metric, target } : null;
  }
  if (condition === "stale") return { stationId, condition: "stale-source", target };
  if (condition === "discrepancy") {
    return validMetric && metric !== "hourly"
      ? { stationId, condition: "source-discrepancy", metric, target }
      : null;
  }
  return null;
}

function parseAlertCondition(value: string | undefined): AlertCondition | null {
  const normalized = value?.trim().toLowerCase();
  switch (normalized) {
    case ">":
    case "above":
    case "over":
    case "gt":
      return "above";
    case "<":
    case "below":
    case "under":
    case "lt":
      return "below";
    case "x":
    case "cross":
    case "crosses":
      return "crosses";
    case "halt":
    case "halted":
      return "halted";
    case "si":
    case "short":
    case "shortfloat":
    case "short_float":
      return "short_float";
    case "ex":
    case "exdiv":
    case "ex-div":
    case "ex_div":
      return "ex_div";
    default:
      return null;
  }
}

export function parseAlertShortcutValues(
  input: string,
  context?: { activeTicker: string | null },
): Record<string, string> {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    const activeTicker = normalizeAlertSymbol(context?.activeTicker);
    return activeTicker ? { symbol: activeTicker } : {};
  }
  if (parts.length > 3) {
    throw new Error("Use SA SYMBOL above|below|crosses PRICE, or halted / short PCT / exdiv DAYS.");
  }

  const values: Record<string, string> = {
    symbol: normalizeAlertSymbol(parts[0]),
  };

  if (parts[1]) {
    const condition = parseAlertCondition(parts[1]);
    if (!condition) {
      throw new Error("Use above, below, crosses, halted, short, or exdiv.");
    }
    values.condition = condition;
  }

  if (parts[2]) {
    if (values.condition === "halted") {
      throw new Error("Halted alerts do not take a target price.");
    }
    const price = Number.parseFloat(parts[2]!.replace(/^\$/, "").replace(/%$/, ""));
    if (!Number.isFinite(price)) {
      throw new Error("Use a numeric target.");
    }
    values.price = String(price);
  }

  return values;
}

export function parseAlertCommandValues(
  values?: Record<string, string>,
): AlertCommandInput | null {
  const shortcut = values?.shortcut?.trim();
  if (shortcut) {
    values = {
      ...values,
      ...parseAlertShortcutValues(shortcut),
    };
  }

  const symbol = values?.symbol?.trim().toUpperCase();
  const condition = parseAlertCondition(values?.condition);
  if (!symbol || !condition) return null;
  if (condition === "halted") {
    return { symbol, condition, price: 0 };
  }
  const priceStr = values?.price?.trim();
  if (!priceStr) return null;
  const price = Number.parseFloat(priceStr);
  if (!Number.isFinite(price)) return null;
  if ((condition === "short_float" || condition === "ex_div") && price < 0) return null;
  return { symbol, condition, price };
}
