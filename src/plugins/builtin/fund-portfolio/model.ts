import type { DataTableColumn } from "../../../components";
import { decodeHtmlEntities } from "../../../utils/html-entities";
import { formatCompact } from "../../../utils/format";

const MAX_HOLDINGS = 25;

export interface FundHolding {
  id: string;
  name: string;
  /** CUSIP when the filing has one, otherwise ISIN. */
  identifier: string;
  value: number | null;
  /** Percent of net assets. `pctVal` is already in percent points. */
  percent: number | null;
}

export interface FundPortfolio {
  ticker: string;
  /** `repPdDate`: the date the holdings are as of, not the fiscal year end. */
  period: string | null;
  netAssets: number | null;
  holdings: FundHolding[];
}

export const HOLDING_COLUMNS: DataTableColumn[] = [
  { id: "name", label: "Name", width: 22, align: "left", flexGrow: 3 },
  { id: "identifier", label: "Identifier", width: 12, align: "left", flexGrow: 1 },
  { id: "value", label: "Value", width: 12, align: "right", flexGrow: 1 },
  { id: "percent", label: "% of assets", width: 12, align: "right", flexGrow: 1 },
];

export function formatHoldingValue(value: number | null | undefined): string {
  return formatCompact(value ?? undefined, { fixedDecimals: true });
}

export function formatNetAssets(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `Net assets ${formatHoldingValue(value)} USD`;
}

/** A weight that rounds to zero reads 0.00%, never -0.00%. */
export function formatAssetPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const fixed = value.toFixed(2);
  return `${/[1-9]/.test(fixed) ? fixed : "0.00"}%`;
}

function tagText(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z_][\\w.-]*:)?${tag}>`, "i"));
  if (!match?.[1]) return null;
  const text = decodeHtmlEntities(match[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return text || null;
}

function tagAttr(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${tag}\\b[^>]*\\bvalue="([^"]*)"`, "i"));
  const value = decodeHtmlEntities(match?.[1] ?? "").trim();
  return value || null;
}

function parseAmount(text: string | null): number | null {
  if (!text) return null;
  const value = Number(text.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

function assignIds(holdings: Array<Omit<FundHolding, "id">>): FundHolding[] {
  const seen = new Set<string>();
  return holdings.map((holding) => {
    const base = holding.identifier || holding.name || "holding";
    let id = base;
    let suffix = 2;
    while (seen.has(id)) {
      id = `${base}:${suffix}`;
      suffix += 1;
    }
    seen.add(id);
    return { ...holding, id };
  });
}

/** The 25 largest `invstOrSec` rows by `valUSD`. */
export function parseHoldings(xml: string): FundPortfolio {
  const parsed: Array<Omit<FundHolding, "id">> = [];
  for (const match of xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?invstOrSec\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?invstOrSec>/gi)) {
    const block = match[1] ?? "";
    const name = tagText(block, "name") ?? tagText(block, "title") ?? "";
    const cusip = tagText(block, "cusip") ?? tagAttr(block, "cusip");
    const isin = tagAttr(block, "isin") ?? tagText(block, "isin");
    const identifier = cusip ?? isin ?? "";
    if (!name && !identifier) continue;
    parsed.push({
      name,
      identifier,
      value: parseAmount(tagText(block, "valUSD")),
      percent: parseAmount(tagText(block, "pctVal")),
    });
  }
  parsed.sort((a, b) => {
    const delta = (b.value ?? Number.NEGATIVE_INFINITY) - (a.value ?? Number.NEGATIVE_INFINITY);
    return delta || a.name.localeCompare(b.name);
  });
  return {
    ticker: "",
    period: tagText(xml, "repPdDate"),
    netAssets: parseAmount(tagText(xml, "netAssets")),
    holdings: assignIds(parsed.slice(0, MAX_HOLDINGS)),
  };
}
