import type { PredictionColumnDef } from "./types";


export const PREDICTION_COLUMN_DEFS: PredictionColumnDef[] = [
  {
    id: "watch",
    label: "★",
    width: 2,
    align: "left",
    description: "Star a market for the prediction watchlist.",
  },
  {
    id: "market",
    label: "MARKET",
    width: 34,
    align: "left",
    description: "Event or primary question.",
  },
  {
    id: "target",
    label: "TARGET",
    width: 18,
    align: "left",
    description: "Selected contract or top target for grouped events.",
  },
  {
    id: "venue",
    label: "VENUE",
    width: 9,
    align: "left",
    description: "Prediction venue.",
  },
  {
    id: "yes",
    label: "TOP ODDS",
    width: 20,
    align: "left",
    description:
      "Implied probability, with the leading target shown inline for grouped events.",
  },
  {
    id: "spread",
    label: "SPR",
    width: 7,
    align: "right",
    description: "Best spread.",
  },
  {
    id: "vol_24h",
    label: "VOL24H",
    width: 11,
    align: "right",
    description: "24-hour volume in dollars.",
  },
  {
    id: "open_interest",
    label: "OI",
    width: 10,
    align: "right",
    description: "Open interest in dollars.",
  },
  {
    id: "ends",
    label: "ENDS",
    width: 15,
    align: "left",
    description: "Market close time.",
  },
  {
    id: "status",
    label: "STATUS",
    width: 8,
    align: "left",
    description: "Market status.",
  },
  {
    id: "event",
    label: "EVENT",
    width: 28,
    align: "left",
    description: "Parent event or series.",
  },
  {
    id: "category",
    label: "CAT",
    width: 12,
    align: "left",
    description: "Venue category.",
  },
  {
    id: "vol_total",
    label: "TOTALVOL",
    width: 11,
    align: "right",
    description: "Total volume in dollars.",
  },
  {
    id: "liquidity",
    label: "LIQ",
    width: 11,
    align: "right",
    description: "Available liquidity.",
  },
  {
    id: "updated",
    label: "UPDATED",
    width: 10,
    align: "left",
    description: "Last upstream update age.",
  },
  {
    id: "created",
    label: "CREATED",
    width: 10,
    align: "left",
    description: "Market creation date.",
  },
  {
    id: "market_id",
    label: "TICKER",
    width: 20,
    align: "left",
    description: "Venue ticker: Kalshi ticker or Polymarket slug.",
  },
];

export const DEFAULT_PREDICTION_COLUMN_IDS = [
  "watch",
  "market",
  "market_id",
  "venue",
  "yes",
  "spread",
  "vol_24h",
  "open_interest",
  "ends",
  "status",
];

export const PREDICTION_COLUMNS_BY_ID = new Map(
  PREDICTION_COLUMN_DEFS.map((column) => [column.id, column]),
);

const PREDICTION_COLUMN_MIN_WIDTH: Record<string, number> = {
  watch: 0,
  market: 0,
  yes: 0,
  spread: 0,
  vol_24h: 88,
  market_id: 100,
  venue: 108,
  open_interest: 116,
  ends: 124,
  status: 132,
};

const DEFAULT_OPTIONAL_COLUMN_MIN_WIDTH = 140;
const MARKET_MIN_WIDTH = 18;

function resolveRequestedPredictionColumns(
  columnIds: readonly string[],
): PredictionColumnDef[] {
  const requested = (columnIds.length > 0 ? columnIds : DEFAULT_PREDICTION_COLUMN_IDS)
    .map((columnId) => PREDICTION_COLUMNS_BY_ID.get(columnId))
    .filter((column): column is PredictionColumnDef => column != null);
  if (requested.length > 0) return requested;
  return DEFAULT_PREDICTION_COLUMN_IDS.map((columnId) =>
    PREDICTION_COLUMNS_BY_ID.get(columnId),
  ).filter((column): column is PredictionColumnDef => column != null);
}

export function createPredictionColumns(
  width: number,
  columnIds: readonly string[] = DEFAULT_PREDICTION_COLUMN_IDS,
): PredictionColumnDef[] {
  const selected = resolveRequestedPredictionColumns(columnIds);
  const visible = selected.filter((column) => {
    const minWidth =
      PREDICTION_COLUMN_MIN_WIDTH[column.id] ?? DEFAULT_OPTIONAL_COLUMN_MIN_WIDTH;
    return width >= minWidth;
  });
  const marketIndex = visible.findIndex((column) => column.id === "market");
  const tableChromeWidth = visible.length + 2;
  const fixedWidth = visible.reduce((sum, column, index) => {
    return index === marketIndex ? sum : sum + column.width;
  }, 0);
  const marketWidth =
    marketIndex >= 0
      ? Math.max(MARKET_MIN_WIDTH, width - fixedWidth - tableChromeWidth)
      : MARKET_MIN_WIDTH;

  return visible.map((column) =>
    column.id === "market"
      ? { ...column, width: marketWidth, flexGrow: 1 }
      : column,
  );
}
