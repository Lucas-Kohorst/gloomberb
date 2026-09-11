import { SecEdgarClient } from "../../../sources/sec-edgar";
import type { SecFilingItem } from "../../../types/data-provider";
import { withConnectionRequest } from "../connections/register";
import {
  FILING_DIFF_CONNECTION_ID,
  normalizeFilingDiffSection,
  type DiffLine,
  type FilingDiffResult,
  type FilingDiffSectionId,
} from "./types";

const TEN_K_FORMS = new Set(["10-K", "10-K/A"]);
const LCS_CELL_BUDGET = 200_000;

const secClient = new SecEdgarClient();

export function splitIntoLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function normalizeDiffLine(line: string): string {
  return line.trim().replace(/\s+/g, " ");
}

function diffLinesLcs(oldLines: string[], newLines: string[]): DiffLine[] {
  const oldKeys = oldLines.map(normalizeDiffLine);
  const newKeys = newLines.map(normalizeDiffLine);
  const rows = oldKeys.length + 1;
  const cols = newKeys.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = oldKeys.length - 1; i >= 0; i -= 1) {
    for (let j = newKeys.length - 1; j >= 0; j -= 1) {
      const base = i * cols + j;
      table[base] = oldKeys[i] === newKeys[j]
        ? (table[(i + 1) * cols + (j + 1)] ?? 0) + 1
        : Math.max(table[(i + 1) * cols + j] ?? 0, table[i * cols + (j + 1)] ?? 0);
    }
  }
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (oldKeys[i] === newKeys[j]) {
      result.push({ type: "unchanged", text: newLines[j]! });
      i += 1;
      j += 1;
    } else if ((table[(i + 1) * cols + j] ?? 0) >= (table[i * cols + (j + 1)] ?? 0)) {
      result.push({ type: "removed", text: oldLines[i]! });
      i += 1;
    } else {
      result.push({ type: "added", text: newLines[j]! });
      j += 1;
    }
  }
  while (i < oldLines.length) {
    result.push({ type: "removed", text: oldLines[i]! });
    i += 1;
  }
  while (j < newLines.length) {
    result.push({ type: "added", text: newLines[j]! });
    j += 1;
  }
  return result;
}

function diffLinesGreedy(oldLines: string[], newLines: string[]): DiffLine[] {
  const oldKeys = oldLines.map(normalizeDiffLine);
  const newKeys = newLines.map(normalizeDiffLine);
  const byKey = new Map<string, number[]>();
  oldKeys.forEach((key, index) => {
    const list = byKey.get(key);
    if (list) list.push(index);
    else byKey.set(key, [index]);
  });
  const used = new Array<boolean>(oldLines.length).fill(false);
  const result: DiffLine[] = [];
  let floor = 0;
  for (let j = 0; j < newLines.length; j += 1) {
    const candidates = byKey.get(newKeys[j]!) ?? [];
    const match = candidates.find((index) => index >= floor && !used[index]);
    if (match === undefined) {
      result.push({ type: "added", text: newLines[j]! });
      continue;
    }
    for (let i = floor; i < match; i += 1) {
      if (!used[i]) {
        result.push({ type: "removed", text: oldLines[i]! });
        used[i] = true;
      }
    }
    used[match] = true;
    floor = match + 1;
    result.push({ type: "unchanged", text: newLines[j]! });
  }
  for (let i = 0; i < oldLines.length; i += 1) {
    if (!used[i]) result.push({ type: "removed", text: oldLines[i]! });
  }
  return result;
}

export function diffLines(oldLines: string[], newLines: string[]): DiffLine[] {
  if (oldLines.length === 0 && newLines.length === 0) return [];
  if (oldLines.length * newLines.length <= LCS_CELL_BUDGET) {
    return diffLinesLcs(oldLines, newLines);
  }
  return diffLinesGreedy(oldLines, newLines);
}

function sliceBetween(
  text: string,
  start: RegExp,
  ends: RegExp[],
): string | null {
  const startMatch = start.exec(text);
  if (!startMatch || startMatch.index === undefined) return null;
  const bodyStart = startMatch.index + startMatch[0].length;
  let bodyEnd = text.length;
  for (const end of ends) {
    const flags = end.flags.includes("g") ? end.flags : `${end.flags}g`;
    const scanner = new RegExp(end.source, flags);
    scanner.lastIndex = bodyStart;
    const hit = scanner.exec(text);
    if (hit && hit.index !== undefined && hit.index < bodyEnd) {
      bodyEnd = hit.index;
    }
  }
  return bodyEnd > bodyStart ? text.slice(bodyStart, bodyEnd) : null;
}

function cleanSectionText(text: string): string {
  return text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

const RISK_START = /ITEM\s+1A\b[^\n]{0,120}RISK\s+FACTORS/i;
const RISK_ENDS = [/ITEM\s+1B\b/i, /ITEM\s+2\b/i];
const MDA_START = /ITEM\s+7\b(?!\s*A)[^\n]{0,160}MANAGEMENT/i;
const MDA_ENDS = [/ITEM\s+7A\b/i, /ITEM\s+8\b/i];

export function extractFilingSection(text: string, section: FilingDiffSectionId): string {
  const normalized = normalizeFilingDiffSection(section);
  if (normalized === "full") return cleanSectionText(text);
  const sliced = normalized === "mda"
    ? sliceBetween(text, MDA_START, MDA_ENDS)
    : sliceBetween(text, RISK_START, RISK_ENDS);
  return cleanSectionText(sliced ?? text);
}

export function parseYearSetting(value: unknown): number | null {
  const text = String(value ?? "").trim();
  if (!/^\d{4}$/.test(text)) return null;
  const year = Number(text);
  return year >= 1994 && year <= 2100 ? year : null;
}

export function pickTenKByYear(
  filings: SecFilingItem[],
  year: number,
): SecFilingItem | undefined {
  return filings.find((filing) => {
    if (!TEN_K_FORMS.has(filing.form.trim())) return false;
    const date = filing.filingDate;
    return date instanceof Date && !Number.isNaN(date.getTime()) && date.getFullYear() === year;
  });
}

export function tenKYears(filings: SecFilingItem[]): number[] {
  const years = new Set<number>();
  for (const filing of filings) {
    if (!TEN_K_FORMS.has(filing.form.trim())) continue;
    const date = filing.filingDate;
    if (date instanceof Date && !Number.isNaN(date.getTime())) {
      years.add(date.getFullYear());
    }
  }
  return [...years].sort((a, b) => b - a);
}

function filingLabel(filing: SecFilingItem): string {
  const date = filing.filingDate;
  const year = date instanceof Date && !Number.isNaN(date.getTime())
    ? String(date.getFullYear())
    : filing.form.trim();
  return `${filing.form.trim()} ${year}`;
}

export async function fetchFilingDiff(options: {
  ticker: string;
  baseYear: unknown;
  compareYear: unknown;
  section: unknown;
}): Promise<FilingDiffResult> {
  const ticker = options.ticker.trim().toUpperCase();
  if (!ticker) throw new Error("Choose a ticker in pane settings.");
  const baseYear = parseYearSetting(options.baseYear);
  const compareYear = parseYearSetting(options.compareYear);
  if (baseYear == null || compareYear == null) {
    throw new Error("Set two 4-digit filing years in pane settings.");
  }
  if (baseYear === compareYear) {
    throw new Error("Pick two different filing years to compare.");
  }
  const section = normalizeFilingDiffSection(options.section);

  const filings = await withConnectionRequest(
    FILING_DIFF_CONNECTION_ID,
    "list-10k",
    () => secClient.getRecentFilings(ticker, 40),
  );
  const candidates = filings.filter((filing) => TEN_K_FORMS.has(filing.form.trim()));
  if (candidates.length === 0) {
    throw new Error(`No 10-K filings found for ${ticker}.`);
  }
  const base = pickTenKByYear(filings, baseYear);
  const compare = pickTenKByYear(filings, compareYear);
  if (!base) throw new Error(`No 10-K found for ${ticker} filed in ${baseYear}.`);
  if (!compare) throw new Error(`No 10-K found for ${ticker} filed in ${compareYear}.`);

  const [baseContent, compareContent] = await withConnectionRequest(
    FILING_DIFF_CONNECTION_ID,
    "diff-content",
    () => Promise.all([
      secClient.getFilingContent({
        form: base.form,
        filingUrl: base.filingUrl,
        primaryDocumentUrl: base.primaryDocumentUrl,
      }),
      secClient.getFilingContent({
        form: compare.form,
        filingUrl: compare.filingUrl,
        primaryDocumentUrl: compare.primaryDocumentUrl,
      }),
    ]),
  );
  if (!baseContent?.trim()) throw new Error(`Base filing text was unavailable (${base.accessionNumber}).`);
  if (!compareContent?.trim()) throw new Error(`Compare filing text was unavailable (${compare.accessionNumber}).`);

  return {
    ticker,
    section,
    baseLabel: filingLabel(base),
    compareLabel: filingLabel(compare),
    baseAccession: base.accessionNumber,
    compareAccession: compare.accessionNumber,
    baseUrl: base.primaryDocumentUrl ?? base.filingUrl ?? null,
    compareUrl: compare.primaryDocumentUrl ?? compare.filingUrl ?? null,
    lines: diffLines(
      splitIntoLines(extractFilingSection(baseContent, section)),
      splitIntoLines(extractFilingSection(compareContent, section)),
    ),
  };
}
