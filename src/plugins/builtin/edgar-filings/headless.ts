import type {
  HeadlessPaneColumn,
  HeadlessPaneDefinition,
  HeadlessPaneLoadArgs,
} from "../../../types/plugin";
import { EdgarFilingsClient, formatAcceptedDetail } from "./client";
import type { EdgarFiling } from "./types";

const COLUMNS: HeadlessPaneColumn[] = [
  { key: "accepted", header: "Accepted" },
  { key: "form", header: "Form" },
  { key: "company", header: "Company" },
  { key: "role", header: "Role" },
  { key: "filed", header: "Filed" },
  { key: "size", header: "Size" },
  { key: "items", header: "Items" },
];

function formOf(args: HeadlessPaneLoadArgs): string {
  const argument = typeof args.argument === "string" ? args.argument : "";
  const option = typeof args.options.form === "string" ? args.options.form : "";
  return (argument || option).trim().toUpperCase();
}

function toRow(filing: EdgarFiling) {
  return {
    id: filing.id,
    accepted: formatAcceptedDetail(filing.acceptedAt),
    filed: filing.filedDate,
    form: filing.form,
    company: filing.companyName,
    role: filing.role,
    cik: filing.cik,
    accession: filing.accessionNumber,
    size: filing.size ?? "",
    items: filing.items.join("; "),
    url: filing.filingUrl,
  };
}

export const edgarFilingsHeadless: HeadlessPaneDefinition<"rows"> = {
  shape: "rows",
  description: "The latest SEC filings as they are accepted, every form. One page; the pane scrolls for older ones.",
  argument: {
    kind: "free-text",
    optional: true,
    placeholder: "form",
    description: "Form type, such as 8-K. Blank lists every form.",
  },
  options: [
    {
      key: "form",
      description: "Form type, such as 8-K. Blank lists every form.",
      type: "string",
      defaultValue: "",
    },
    {
      key: "limit",
      aliases: ["count", "rows"],
      description: "Maximum rows from the latest page.",
      type: "integer",
      defaultValue: 100,
      minimum: 1,
      maximum: 100,
    },
  ],
  columns: COLUMNS,
  async load(args, ctx) {
    const form = formOf(args);
    const limit = Math.min(100, Math.max(1, Number(args.options.limit ?? 100) || 100));
    const page = await new EdgarFilingsClient().latestFilings({ form, signal: ctx.signal });
    return {
      columns: COLUMNS,
      rows: page.rows.slice(0, limit).map(toRow),
      complete: !page.hasMore && page.rows.length <= limit,
    };
  },
};
