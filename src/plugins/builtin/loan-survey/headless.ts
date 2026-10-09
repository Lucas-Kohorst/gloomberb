import type { HeadlessPaneColumn, HeadlessPaneDefinition } from "../../../types/plugin";
import { fetchLoanSurvey } from "./client";
import {
  LOAN_SURVEY_SERIES,
  formatNetChange,
  formatNetPercent,
  loanSurveyRows,
  surveyAsOf,
  type LoanSurveyRow,
} from "./model";

const percent = (value: unknown) => formatNetPercent(typeof value === "number" ? value : null);
const change = (value: unknown) => formatNetChange(typeof value === "number" ? value : null);

const QUARTER: HeadlessPaneColumn = { key: "quarter", header: "Quarter" };
const NET: HeadlessPaneColumn = { key: "netPercent", header: "Net %", align: "right", format: percent };
const PREVIOUS: HeadlessPaneColumn = { key: "previous", header: "Previous", align: "right", format: percent };
const CHANGE: HeadlessPaneColumn = { key: "change", header: "Change", align: "right", format: change };

function latestRow(row: LoanSurveyRow) {
  return {
    id: row.id,
    name: row.name,
    quarter: row.quarter,
    netPercent: row.netPercent,
    previous: row.previous,
    change: row.change,
  };
}

function historyRow(quarter: LoanSurveyRow["recent"][number]) {
  return {
    date: quarter.date,
    quarter: quarter.quarter,
    netPercent: quarter.netPercent,
    previous: quarter.previous,
    change: quarter.change,
  };
}

export const loanSurveyHeadless: HeadlessPaneDefinition<"bundle"> = {
  shape: "bundle",
  argument: { kind: "none" },
  options: [],
  discovery: {
    aliases: ["SLOO"],
    dataRequirements: ["Quarterly senior loan officer survey"],
    limitations: [
      "Net percent of domestic banks tightening standards, not seasonally adjusted",
      "Positive means more banks tightened than eased",
      "A missing print is skipped, so previous is the prior observation",
    ],
  },
  describe: "Net percent of banks tightening lending standards",
  async load() {
    const loaded = await fetchLoanSurvey();
    const rows = loanSurveyRows(loaded.series);
    const quarter = surveyAsOf(rows);
    const present = new Set(rows.map((row) => row.id));
    return {
      complete: loaded.errors.length === 0 && present.size === LOAN_SURVEY_SERIES.length,
      errors: loaded.errors,
      unavailableSymbols: LOAN_SURVEY_SERIES.filter((series) => !present.has(series.id)).map((series) => series.name),
      sections: [
        {
          title: quarter ? `Net percent tightening, ${quarter}` : "Net percent tightening",
          columns: [{ key: "name", header: "Series" }, QUARTER, NET, PREVIOUS, CHANGE],
          rows: rows.map(latestRow),
        },
        ...rows.map((row) => ({
          title: row.name,
          columns: [QUARTER, NET, PREVIOUS, CHANGE],
          rows: row.recent.map(historyRow),
        })),
      ],
      metadata: { quarter },
    };
  },
};
