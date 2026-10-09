import type { HeadlessPaneColumn, HeadlessPaneDefinition } from "../../../types/plugin";
import { fetchCanadaListings } from "./client";
import {
  filterCanadaListings,
  formatListingChange,
  formatListingPercent,
  formatListingPrice,
  formatListingVolume,
  normalizeListingSymbol,
  type CanadaListing,
} from "./model";

const price = (value: unknown) => formatListingPrice(typeof value === "number" ? value : null);
const percent = (value: unknown) => formatListingPercent(typeof value === "number" ? value : null);
const volume = (value: unknown) => formatListingVolume(typeof value === "number" ? value : null);

const COLUMNS: HeadlessPaneColumn[] = [
  { key: "symbol", header: "Symbol" },
  { key: "name", header: "Name" },
  { key: "last", header: "Last", align: "right", format: price },
  {
    key: "change",
    header: "Change",
    align: "right",
    format: (value, row) => formatListingChange(
      typeof value === "number" ? value : null,
      typeof row.last === "number" ? row.last : null,
    ),
  },
  { key: "changePercent", header: "Chg %", align: "right", format: percent },
  { key: "volume", header: "Volume", align: "right", format: volume },
];

function listingRow(row: CanadaListing) {
  return {
    symbol: row.symbol,
    name: row.name,
    last: row.last,
    change: row.change,
    changePercent: row.changePercent,
    volume: row.volume,
  };
}

export const canadaListingsHeadless: HeadlessPaneDefinition<"bundle"> = {
  shape: "bundle",
  argument: {
    kind: "free-text",
    optional: true,
    placeholder: "symbol",
    description: "Symbol to keep, such as BCE or RCI. Omit it for the full board.",
  },
  options: [],
  discovery: {
    aliases: ["TMX"],
    dataRequirements: ["Toronto Stock Exchange most active listings"],
    limitations: [
      "Ranked by session share volume",
      "Toronto Stock Exchange only",
      "The feed does not publish a delay or an as-of time",
    ],
  },
  describe: "Most active Toronto listings",
  async load(args, ctx) {
    const raw = Array.isArray(args.argument) ? args.argument.join(" ") : (args.argument ?? "");
    const symbol = normalizeListingSymbol(raw);
    const rows = filterCanadaListings(await fetchCanadaListings(ctx.signal), raw);
    return {
      sections: [{ title: symbol || "Most active", columns: COLUMNS, rows: rows.map(listingRow) }],
      complete: !symbol || rows.length > 0,
      ...(symbol && rows.length === 0 ? { errors: [`${symbol} is not among the most active listings`] } : {}),
      symbols: rows.map((row) => row.symbol),
    };
  },
};
