import type { HeadlessPaneDefinition } from "../../../types/plugin";
import { getSharedAdjacentClient, loadCftcFilings } from "./client";
import { filterAdjacentRows } from "./search";
import { normalizeAdjacentIndex, normalizeAdjacentRate } from "./normalize";
import { filingKindLabel } from "./filings-format";

type AdjacentView = "indices" | "rates" | "cftc";

function viewOf(value: unknown): AdjacentView {
  return value === "rates" || value === "cftc" ? value : "indices";
}

function queryOf(argument: string | string[] | null): string {
  return typeof argument === "string" ? argument.trim() : "";
}

export const adjacentHeadless: HeadlessPaneDefinition<"rows"> = {
  shape: "rows",
  argument: {
    kind: "free-text",
    placeholder: "name",
    description: "Optional name, ticker, organization, or product.",
    optional: true,
  },
  options: [{
    key: "view",
    description: "Indices, reference rates, or CFTC filings.",
    type: "enum",
    defaultValue: "indices",
    values: [
      { value: "indices" },
      { value: "rates" },
      { value: "cftc" },
    ],
  }],
  describe: (args) => {
    const view = viewOf(args.options.view);
    const query = queryOf(args.argument);
    return query ? `Adjacent ${view} | ${query}` : `Adjacent ${view}`;
  },
  async load(args) {
    const view = viewOf(args.options.view);
    const query = queryOf(args.argument);
    const client = getSharedAdjacentClient();
    if (view === "rates") {
      const payload = await client.getRates();
      const rows = filterAdjacentRows(
        (payload.data ?? []).map(normalizeAdjacentRate),
        query,
        (row) => `${row.name} ${row.id}`,
      );
      return {
        columns: [
          { key: "name", header: "Name" },
          { key: "value", header: "Value", align: "right" },
          { key: "change", header: "1D", align: "right" },
        ],
        rows: rows.map((row) => ({
          name: row.name,
          value: row.value,
          change: row.change1d,
        })),
      };
    }
    if (view === "cftc") {
      const page = await loadCftcFilings(client, query, 50);
      return {
        columns: [
          { key: "org", header: "Org" },
          { key: "kind", header: "Kind" },
          { key: "title", header: "Title" },
          { key: "status", header: "Status" },
        ],
        rows: page.filings.map((filing) => ({
          org: filing.orgCode,
          kind: filingKindLabel(filing),
          title: filing.title,
          status: filing.status,
        })),
      };
    }
    const payload = await client.getIndices();
    const rows = filterAdjacentRows(
      (payload.data ?? []).map(normalizeAdjacentIndex),
      query,
      (row) => `${row.ticker} ${row.name} ${row.id}`,
    );
    return {
      columns: [
        { key: "ticker", header: "Ticker" },
        { key: "name", header: "Name" },
        { key: "value", header: "Level", align: "right" },
        { key: "change", header: "1D", align: "right" },
      ],
      rows: rows.map((row) => ({
        ticker: row.ticker,
        name: row.name,
        value: row.value,
        change: row.change1d,
      })),
    };
  },
};
