import { httpFetch } from "../../../utils/http-transport";
import {
  latestPayYear,
  NO_PAY_FACTS,
  type PayPerformanceBoard,
  type PayPerformanceRow,
} from "./model";

const USER_AGENT = "gloomberb research lucas@kohor.st";
const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts";
const FETCH_TIMEOUT_MS = 30_000;
const ANNUAL_MS = 300 * 86_400_000;

const HEADERS = {
  Accept: "application/json",
  "User-Agent": USER_AGENT,
};

type Measure = "compensation" | "company" | "peer";

interface Cursor {
  text: string;
  i: number;
}

interface Candidate {
  year: number;
  measure: Measure;
  value: number;
  filed: string;
  rank: number;
  index: number;
}

const READ_ERROR = "Company facts could not be read.";

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export function normalizePayTicker(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

function tickerKey(value: string): string {
  return normalizePayTicker(value).replace(/\./g, "-");
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Tag or concept label, not the long description under it. */
export function mentionsPayPerformance(value: string): boolean {
  const spaced = value.toLowerCase();
  if (spaced.includes("compensation actually paid") || spaced.includes("total shareholder return")) return true;
  const flat = compact(value);
  return flat.includes("pvp")
    || flat.includes("compactuallypaid")
    || flat.includes("compensationactuallypaid")
    || flat.includes("actuallypaidcomp")
    || flat.includes("totalshareholderrtn")
    || flat.includes("totalshareholderreturn")
    || flat.includes("shareholderrtn")
    || flat.includes("shareholderreturn");
}

function mentionsCompensation(value: string, flat: string): boolean {
  return value.toLowerCase().includes("compensation actually paid")
    || flat.includes("compactuallypaid")
    || flat.includes("compensationactuallypaid")
    || flat.includes("actuallypaidcomp");
}

function mentionsShareholderReturn(value: string, flat: string): boolean {
  return value.toLowerCase().includes("total shareholder return")
    || flat.includes("totalshareholderrtn")
    || flat.includes("totalshareholderreturn")
    || flat.includes("shareholderrtn")
    || flat.includes("shareholderreturn");
}

function measureOf(tag: string, label: string): Measure | null {
  const text = `${tag} ${label}`;
  if (!mentionsPayPerformance(text)) return null;
  const flat = compact(text);
  const compensation = mentionsCompensation(text, flat);
  const shareholder = mentionsShareholderReturn(text, flat);
  if (compensation && shareholder) return null;
  if (flat.includes("peer") && shareholder) return "peer";
  if (shareholder) return "company";
  if (compensation) return "compensation";
  return null;
}

/** Principal executive outranks the named-officer average when a year has both. */
function compensationRank(tag: string, label: string): number {
  const flat = compact(`${tag} ${label}`);
  if (flat.includes("nonpeo") || flat.includes("avg")) return 1;
  if (flat.includes("peo")) return 3;
  return 2;
}

function factYear(fact: Record<string, unknown>): number | null {
  const fiscal = fact.fy;
  if (typeof fiscal === "number" && fiscal >= 1900 && fiscal <= 2100) return fiscal;
  if (typeof fact.end === "string") {
    const end = /^(\d{4})-\d{2}-\d{2}$/.exec(fact.end);
    if (end) return Number(end[1]);
  }
  if (typeof fact.frame === "string") {
    const frame = /^CY(\d{4})$/i.exec(fact.frame);
    if (frame) return Number(frame[1]);
  }
  return null;
}

function isAnnual(fact: Record<string, unknown>): boolean {
  const frame = typeof fact.frame === "string" ? fact.frame : "";
  if (/Q[1-4]$/i.test(frame)) return false;
  const period = typeof fact.fp === "string" ? fact.fp.toUpperCase() : "";
  if (period && period !== "FY") return false;
  const start = typeof fact.start === "string" ? Date.parse(`${fact.start}T00:00:00Z`) : Number.NaN;
  const end = typeof fact.end === "string" ? Date.parse(`${fact.end}T00:00:00Z`) : Number.NaN;
  if (Number.isFinite(start) && Number.isFinite(end) && end - start < ANNUAL_MS) return false;
  return true;
}

function numericFacts(concept: Record<string, unknown>): unknown[] {
  const units = record(concept.units);
  if (!units) return [];
  const keys = Object.keys(units).sort((left, right) => unitRank(left) - unitRank(right));
  for (const key of keys) {
    const facts = units[key];
    if (!Array.isArray(facts)) continue;
    if (facts.some((fact) => {
      const row = record(fact);
      return typeof row?.val === "number" && Number.isFinite(row.val);
    })) return facts;
  }
  return [];
}

function unitRank(unit: string): number {
  if (unit.toUpperCase() === "USD") return 0;
  if (unit.toLowerCase() === "pure") return 1;
  return 2;
}

function betterCandidate(next: Candidate, current: Candidate): boolean {
  if (next.filed !== current.filed) return next.filed > current.filed;
  if (next.rank !== current.rank) return next.rank > current.rank;
  return next.index > current.index;
}

function rowsFromConcepts(concepts: Array<{ tag: string; label: string; concept: Record<string, unknown> }>): PayPerformanceRow[] {
  const chosen = new Map<string, Candidate>();
  let index = 0;
  for (const { tag, label, concept } of concepts) {
    const measure = measureOf(tag, label);
    if (!measure) continue;
    const rank = measure === "compensation" ? compensationRank(tag, label) : 0;
    for (const raw of numericFacts(concept)) {
      const fact = record(raw);
      if (!fact || !isAnnual(fact)) continue;
      const value = fact.val;
      const year = factYear(fact);
      if (typeof value !== "number" || !Number.isFinite(value) || year == null) continue;
      const candidate: Candidate = {
        year,
        measure,
        value,
        filed: typeof fact.filed === "string" ? fact.filed : "",
        rank,
        index,
      };
      index += 1;
      const key = `${year}:${measure}`;
      const current = chosen.get(key);
      if (!current || betterCandidate(candidate, current)) chosen.set(key, candidate);
    }
  }

  const byYear = new Map<number, PayPerformanceRow>();
  for (const candidate of chosen.values()) {
    const row = byYear.get(candidate.year) ?? {
      year: candidate.year,
      compensationActuallyPaid: null,
      companyReturn: null,
      peerReturn: null,
    };
    if (candidate.measure === "compensation") row.compensationActuallyPaid = candidate.value;
    else if (candidate.measure === "company") row.companyReturn = candidate.value;
    else row.peerReturn = candidate.value;
    byYear.set(candidate.year, row);
  }
  return [...byYear.values()].sort((left, right) => right.year - left.year);
}

function matchedConcepts(document: unknown): Array<{ tag: string; label: string; concept: Record<string, unknown> }> {
  const facts = record(record(document)?.facts);
  if (!facts) return [];
  const matched: Array<{ tag: string; label: string; concept: Record<string, unknown> }> = [];
  for (const namespace of Object.values(facts)) {
    const concepts = record(namespace);
    if (!concepts) continue;
    for (const [tag, value] of Object.entries(concepts)) {
      const concept = record(value);
      if (!concept) continue;
      const label = typeof concept.label === "string" ? concept.label : "";
      if (mentionsPayPerformance(tag) || mentionsPayPerformance(label)) matched.push({ tag, label, concept });
    }
  }
  return matched;
}

export function parsePayFacts(document: unknown): PayPerformanceRow[] {
  const matched = matchedConcepts(document);
  if (matched.length === 0) throw new Error(NO_PAY_FACTS);
  return rowsFromConcepts(matched);
}

function skipWs(cursor: Cursor): void {
  const { text } = cursor;
  let { i } = cursor;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code !== 32 && code !== 9 && code !== 10 && code !== 13) break;
    i += 1;
  }
  cursor.i = i;
}

function expectChar(cursor: Cursor, char: string): void {
  if (cursor.text[cursor.i] !== char) throw new Error(READ_ERROR);
  cursor.i += 1;
}

function parseString(cursor: Cursor): string {
  expectChar(cursor, '"');
  const { text } = cursor;
  let out = "";
  while (cursor.i < text.length) {
    const char = text[cursor.i]!;
    if (char === '"') {
      cursor.i += 1;
      return out;
    }
    if (char === "\\") {
      const next = text[cursor.i + 1];
      if (next === "u") {
        out += String.fromCharCode(Number.parseInt(text.slice(cursor.i + 2, cursor.i + 6), 16));
        cursor.i += 6;
        continue;
      }
      const escaped: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
      out += next ? escaped[next] ?? next : "";
      cursor.i += 2;
      continue;
    }
    out += char;
    cursor.i += 1;
  }
  throw new Error(READ_ERROR);
}

function skipString(cursor: Cursor): void {
  expectChar(cursor, '"');
  const { text } = cursor;
  while (cursor.i < text.length) {
    const char = text[cursor.i]!;
    if (char === '"') {
      cursor.i += 1;
      return;
    }
    cursor.i += char === "\\" ? (text[cursor.i + 1] === "u" ? 6 : 2) : 1;
  }
  throw new Error(READ_ERROR);
}

function skipNumber(cursor: Cursor): void {
  const { text } = cursor;
  const start = cursor.i;
  while (cursor.i < text.length && /[0-9eE+.\-]/.test(text[cursor.i]!)) cursor.i += 1;
  if (cursor.i === start) throw new Error(READ_ERROR);
}

function skipLiteral(cursor: Cursor, literal: string): void {
  if (cursor.text.slice(cursor.i, cursor.i + literal.length) !== literal) throw new Error(READ_ERROR);
  cursor.i += literal.length;
}

function skipValue(cursor: Cursor): void {
  const before = cursor.i;
  skipWs(cursor);
  const char = cursor.text[cursor.i];
  if (char === '"') skipString(cursor);
  else if (char === "{") forEachEntry(cursor, () => skipValue(cursor));
  else if (char === "[") skipArray(cursor);
  else if (char === "t") skipLiteral(cursor, "true");
  else if (char === "f") skipLiteral(cursor, "false");
  else if (char === "n") skipLiteral(cursor, "null");
  else if (char === "-" || (char !== undefined && char >= "0" && char <= "9")) skipNumber(cursor);
  else throw new Error(READ_ERROR);
  if (cursor.i <= before) throw new Error(READ_ERROR);
}

function skipArray(cursor: Cursor): void {
  expectChar(cursor, "[");
  let first = true;
  while (cursor.i < cursor.text.length) {
    skipWs(cursor);
    if (cursor.text[cursor.i] === "]") {
      cursor.i += 1;
      return;
    }
    if (!first) expectChar(cursor, ",");
    first = false;
    skipValue(cursor);
  }
  throw new Error(READ_ERROR);
}

function forEachEntry(cursor: Cursor, visit: (key: string) => void): void {
  skipWs(cursor);
  expectChar(cursor, "{");
  let first = true;
  while (cursor.i < cursor.text.length) {
    skipWs(cursor);
    if (cursor.text[cursor.i] === "}") {
      cursor.i += 1;
      return;
    }
    if (!first) expectChar(cursor, ",");
    first = false;
    skipWs(cursor);
    const key = parseString(cursor);
    skipWs(cursor);
    expectChar(cursor, ":");
    visit(key);
  }
  throw new Error(READ_ERROR);
}

function readConcept(cursor: Cursor, tag: string): unknown | null {
  skipWs(cursor);
  if (cursor.text[cursor.i] !== "{") {
    skipValue(cursor);
    return null;
  }
  const start = cursor.i;
  let label = "";
  forEachEntry(cursor, (key) => {
    skipWs(cursor);
    if (key === "label" && cursor.text[cursor.i] === '"') label = parseString(cursor);
    else skipValue(cursor);
  });
  if (!mentionsPayPerformance(tag) && !mentionsPayPerformance(label)) return null;
  return JSON.parse(cursor.text.slice(start, cursor.i)) as unknown;
}

/**
 * Company-facts files are large. Walk the text and parse only concepts whose
 * tag or label is pay versus performance, instead of keeping the document.
 */
export function extractPayFactDocument(text: string): { facts: Record<string, Record<string, unknown>> } {
  const cursor: Cursor = { text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, i: 0 };
  const facts: Record<string, Record<string, unknown>> = {};
  forEachEntry(cursor, (key) => {
    if (key !== "facts") {
      skipValue(cursor);
      return;
    }
    forEachEntry(cursor, (namespace) => {
      skipWs(cursor);
      if (cursor.text[cursor.i] !== "{") {
        skipValue(cursor);
        return;
      }
      const bucket: Record<string, unknown> = {};
      forEachEntry(cursor, (tag) => {
        const concept = readConcept(cursor, tag);
        if (concept) bucket[tag] = concept;
      });
      if (Object.keys(bucket).length > 0) facts[namespace] = bucket;
    });
  });
  return { facts };
}

export function cikForTicker(payload: unknown, ticker: string): string | null {
  const wanted = tickerKey(ticker);
  if (!wanted) return null;
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
      ? Object.values(payload as Record<string, unknown>)
      : [];
  for (const row of rows) {
    const recordRow = record(row);
    if (!recordRow || tickerKey(String(recordRow.ticker ?? "")) !== wanted) continue;
    const digits = String(recordRow.cik_str ?? "").replace(/\D/g, "");
    if (digits) return digits.padStart(10, "0");
  }
  return null;
}

async function readJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await httpFetch(url, { headers: HEADERS, signal: requestSignal(signal) });
  if (!response.ok) throw new Error(`Company lookup failed (${response.status}).`);
  return response.json() as Promise<unknown>;
}

export async function fetchPayPerformance(ticker: string, signal?: AbortSignal): Promise<PayPerformanceBoard> {
  const normalized = normalizePayTicker(ticker);
  if (!normalized) throw new Error("A ticker is required.");
  const listed = await readJson(TICKERS_URL, signal);
  const cik = cikForTicker(listed, normalized);
  if (!cik) throw new Error("No company for this ticker.");

  const response = await httpFetch(`${FACTS_URL}/CIK${cik}.json`, { headers: HEADERS, signal: requestSignal(signal) });
  if (response.status === 404) throw new Error("No company facts for this ticker.");
  if (!response.ok) throw new Error(`Company facts request failed (${response.status}).`);
  const text = await response.text();
  if (!text || text.trimStart().startsWith("<")) throw new Error(READ_ERROR);
  const rows = parsePayFacts(extractPayFactDocument(text));
  return { ticker: normalized, rows, latestYear: latestPayYear(rows) };
}
