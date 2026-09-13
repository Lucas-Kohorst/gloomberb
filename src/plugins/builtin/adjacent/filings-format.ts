import { formatTimeAgo } from "../../../utils/format";
import {
  CFTC_FEED_LABELS,
  CFTC_KIND_LABELS,
  type CftcFiling,
  type CftcFilingDetail,
  type CftcFilingKind,
} from "./types";

export function formatDate(date: Date | undefined): string | undefined {
  if (!date || Number.isNaN(date.getTime()) || date.getTime() === 0) return undefined;
  return date.toISOString().slice(0, 10);
}

/** CFTC publishes a calendar date with no time. Show 9/11/26, not 20h ago. */
export function formatFilingDay(date: Date | undefined): string | undefined {
  const valid = validFilingDate(date);
  if (!valid) return undefined;
  return valid.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
    timeZone: "UTC",
  });
}

export function feedLabel(filing: CftcFiling): string {
  return CFTC_FEED_LABELS[filing.feed] ?? filing.feed;
}

export function filingKind(filing: CftcFiling): CftcFilingKind {
  switch (filing.feed) {
    case "dcm_products":
      return "new-contract";
    case "dco":
      return "registration";
    case "ptc_dcm_rules":
    case "dco_rules":
      return "amendment";
  }
}

export function filingKindLabel(filing: CftcFiling): string {
  return CFTC_KIND_LABELS[filingKind(filing)];
}

/** Compact title for shares and pop-outs. The table keeps type and status as columns. */
export function filingListTitle(filing: CftcFiling): string {
  const kind = filingKindLabel(filing);
  const status = filing.status.trim();
  const prefix = status ? `${kind} · ${status}` : kind;
  return `${prefix} | ${filing.title}`;
}

function validFilingDate(date: Date | undefined): Date | undefined {
  if (!date || Number.isNaN(date.getTime()) || date.getTime() === 0) return undefined;
  return date;
}

/** CFTC status/receipt date — when the filing was published, not when Adjacent ingested it. */
export function filingPublishedAt(filing: CftcFiling): Date | undefined {
  return validFilingDate(filing.statusDate) ?? validFilingDate(filing.receiptDate);
}

/** When Adjacent first (then last) saw the filing. */
export function filingSeenAt(filing: CftcFiling): Date | undefined {
  return validFilingDate(filing.firstSeenAt) ?? validFilingDate(filing.lastSeenAt);
}

/**
 * Live SEEN label for table row memo. The footer clock re-renders the pane
 * every minute; including this string in the revision is what lets "6m ago"
 * step to "7m ago" without a new fetch. DAY is a calendar date, so it stays put.
 */
export function filingRelativeTimeRevision(filing: CftcFiling): string {
  const seen = filingSeenAt(filing);
  return seen ? formatTimeAgo(seen) : "";
}

/** Article/share timestamp: published if we have it, otherwise seen. */
export function filingListTimestamp(filing: CftcFiling): Date {
  return filingPublishedAt(filing) ?? filingSeenAt(filing) ?? new Date(0);
}

/**
 * Feed-specific columns: DCM product rows carry type/category, rules rows carry
 * a description, DCO rows carry remarks. `title` already holds the best of
 * those, so this only adds what the title does not repeat.
 */
export function filingClassification(filing: CftcFiling): string | undefined {
  const parts = [filing.productType, filing.category, filing.subcategory]
    .filter((part): part is string => !!part);
  const unique = parts.filter((part, index) => parts.indexOf(part) === index);
  return unique.length > 0 ? unique.join(" · ") : undefined;
}

export function buildDetailMeta(filing: CftcFiling): string[] {
  const meta: string[] = [];
  meta.push(filingKindLabel(filing));
  if (filing.status) meta.push(filing.status);
  const statusDate = formatDate(filing.statusDate);
  if (statusDate) meta.push(statusDate);
  meta.push(feedLabel(filing));
  const receipt = formatDate(filing.receiptDate);
  if (receipt) meta.push(`received ${receipt}`);
  const predicted = formatDate(filing.predictedEffectiveDate);
  if (predicted) meta.push(`est. effective ${predicted}`);
  if (filing.docCount > 0) {
    meta.push(`${filing.docCount} doc${filing.docCount === 1 ? "" : "s"}`);
  }
  return meta;
}

/**
 * The API markdown opens with an H1 and a `- **Key:** value` facts block that
 * restate the detail title and meta row, so both are dropped before render.
 */
export function stripMarkdownHeader(markdown: string, title: string): string {
  const lines = markdown.split("\n");
  let index = 0;
  const skipBlank = () => {
    while (index < lines.length && lines[index]!.trim() === "") index += 1;
  };

  skipBlank();
  if (index < lines.length && lines[index]!.startsWith("# ")) index += 1;
  skipBlank();
  while (index < lines.length && lines[index]!.trimStart().startsWith("- **")) index += 1;
  skipBlank();

  if (index < lines.length && /^##\s+description$/i.test(lines[index]!.trim())) {
    let lookahead = index + 1;
    while (lookahead < lines.length && lines[lookahead]!.trim() === "") lookahead += 1;
    if (lookahead < lines.length && lines[lookahead]!.trim() === title.trim()) {
      index = lookahead + 1;
      skipBlank();
    }
  }

  return lines.slice(index).join("\n").trim();
}

/**
 * The article reader shows the title in its own header, so a leading H1
 * duplicates it. The facts block is kept: the reader has no meta row.
 */
export function stripLeadingHeading(markdown: string): string {
  const lines = markdown.split("\n");
  let index = 0;
  while (index < lines.length && lines[index]!.trim() === "") index += 1;
  if (index >= lines.length || !lines[index]!.startsWith("# ")) return markdown.trim();
  index += 1;
  while (index < lines.length && lines[index]!.trim() === "") index += 1;
  return lines.slice(index).join("\n").trim();
}

/** Falls back to the list row's own fields until the attachment text arrives. */
export function buildDetailBody(
  filing: CftcFiling,
  detail: CftcFilingDetail | null,
  loading: boolean,
): string {
  if (loading) return "Loading filing text...";

  const body = detail ? stripMarkdownHeader(detail.markdown, filing.title) : "";
  if (body) return body;

  const sections = [
    filingClassification(filing),
    filing.description && filing.description !== filing.title ? filing.description : undefined,
    filing.productsAffected ? `Products affected: ${filing.productsAffected}` : undefined,
    filing.remarks ? `Remarks: ${filing.remarks}` : undefined,
  ].filter((section): section is string => !!section);

  return sections.length > 0
    ? sections.join("\n\n")
    : "No further detail was published for this filing.";
}
