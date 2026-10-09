import type { HeadlessPaneDefinition } from "../../../types/plugin";
import { fetchNordicRates } from "./client";
import { formatRate } from "./model";

const MORTGAGE_COLUMNS = [
  { key: "lender", header: "Lender" },
  { key: "term", header: "Term" },
  { key: "rate", header: "Rate %", align: "right" as const, format: formatRate },
];

const BOND_COLUMNS = [
  { key: "segment", header: "Segment" },
  { key: "maturity", header: "Maturity" },
  { key: "yield", header: "Yield %", align: "right" as const, format: formatRate },
];

export const nordicRatesHeadless: HeadlessPaneDefinition<"bundle"> = {
  shape: "bundle",
  argument: { kind: "none" },
  options: [],
  discovery: {
    aliases: ["NMRT"],
    dataRequirements: ["Nordic mortgage rate grid", "Danish average bond yield grid"],
    limitations: [
      "Mortgage quotes have no published date",
      "Bond rows are before-tax effective yields by residual maturity; counts and weights are left out",
    ],
  },
  describe: "Nordic mortgage rates and average bond yields",
  async load(_args, ctx) {
    const board = await fetchNordicRates(ctx.signal);
    const errors = [board.mortgageError, board.yieldError].filter((entry): entry is string => !!entry);
    return {
      complete: errors.length === 0,
      errors,
      metadata: { asOf: board.asOf },
      sections: [
        {
          title: "Mortgage rates",
          columns: MORTGAGE_COLUMNS,
          rows: board.mortgages.map(({ lender, term, rate }) => ({ lender, term, rate })),
        },
        {
          title: board.asOf ? `Bond yields ${board.asOf}` : "Bond yields",
          columns: BOND_COLUMNS,
          rows: board.yields.map(({ segment, maturity, yield: rate }) => ({ segment, maturity, yield: rate })),
        },
      ],
    };
  },
};
