import type { HeadlessPaneColumn, HeadlessPaneDefinition } from "../../../types/plugin";
import { fetchFactorReturns } from "./client";
import { FACTOR_FIELDS, formatFactorMonth, formatFactorPercent, type FactorMonth } from "./model";

const percent = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? formatFactorPercent(value) : "--";

const COLUMNS: HeadlessPaneColumn[] = FACTOR_FIELDS.map((field) => ({
  key: field.key,
  header: field.header,
  align: field.align,
  ...(field.key === "month" ? {} : { format: percent }),
}));

function reportRow(row: FactorMonth) {
  return {
    month: formatFactorMonth(row.month),
    marketMinusRf: row.marketMinusRf,
    size: row.size,
    value: row.value,
    rf: row.rf,
  };
}

export const famaFrenchHeadless: HeadlessPaneDefinition<"bundle"> = {
  shape: "bundle",
  description: "The latest 36 months of market, size, value and risk-free returns, in percent.",
  argument: { kind: "none" },
  options: [],
  describe: "Monthly market, size, value and risk-free returns",
  discovery: {
    aliases: ["FFAC"],
    dataRequirements: ["Monthly CRSP factor file"],
    limitations: ["Monthly returns in percent", "The latest 36 months, newest first", "Annual factors are not included"],
  },
  async load(_args, ctx) {
    const data = await fetchFactorReturns(ctx.signal);
    return {
      complete: true,
      sections: [{ title: data.vintage, columns: COLUMNS, rows: data.months.map(reportRow) }],
      metadata: { vintage: data.vintage },
    };
  },
};
