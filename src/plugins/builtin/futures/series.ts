import type { SeriesDefinition } from "../../../series/types";
import { FUTURES_CONTRACTS, FUTURES_SECTOR_LABELS, type FuturesContract } from "../../../market-data/futures-board";

/**
 * The unit the board prints, not a blanket dollar price. Index futures are
 * points, rates are points (the board prints decimals, not 32nds), cents
 * contracts are USX, and a declared quote unit wins over USD.
 */
export function futuresSeriesUnit(contract: FuturesContract): string {
  if (contract.unit?.startsWith("US cents")) return "USX";
  if (contract.unit?.startsWith("EUR")) return "EUR";
  if (contract.unit?.startsWith("USD")) return "USD";
  if (contract.sector === "equity-index" || contract.sector === "rates") return "points";
  if (contract.sector === "currencies") return "index";
  return "USD";
}

/** Each continuous front-month contract on the futures board, as `FUT:ES`. */
export const FUTURES_SERIES: readonly SeriesDefinition[] = FUTURES_CONTRACTS.map((contract) => ({
  id: `fut:${contract.code}`,
  name: contract.name,
  unit: futuresSeriesUnit(contract),
  frequency: "daily",
  group: "Futures",
  tags: [contract.code, FUTURES_SECTOR_LABELS[contract.sector], "futures", "front month"],
  expression: `FUT:${contract.code}`,
}));
