import { httpFetch } from "../../../utils/http-transport";
import { parseHoldings, type FundPortfolio } from "./model";

const USER_AGENT = "gloomberb research lucas@kohor.st";
const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const MAX_FILING_BYTES = 1_500_000;
const FETCH_TIMEOUT_MS = 20_000;
const NO_FILING = "No fund holdings filing for this ticker.";
const TOO_LARGE = "This filing is too large to read here.";

export interface NportFiling {
  accession: string;
  primaryDocument: string;
  filingDate: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim());
}

export function cikForTicker(payload: unknown, ticker: string): string | null {
  const wanted = ticker.trim().toUpperCase();
  if (!wanted) return null;
  const entries = Array.isArray(payload) ? payload : payload && typeof payload === "object" ? Object.values(payload) : [];
  for (const entry of entries) {
    const row = record(entry);
    if (!row || String(row.ticker ?? "").trim().toUpperCase() !== wanted) continue;
    const digits = String(row.cik_str ?? "").replace(/\D/g, "");
    if (digits) return digits.padStart(10, "0");
  }
  return null;
}

/** The newest `NPORT-P` in `filings.recent`. Amendments are a different form. */
export function latestNportFiling(payload: unknown): NportFiling | null {
  const recent = record(record(record(payload)?.filings)?.recent);
  if (!recent) return null;
  const forms = asStrings(recent.form);
  const accessions = asStrings(recent.accessionNumber);
  const documents = asStrings(recent.primaryDocument);
  const dates = asStrings(recent.filingDate);
  let best: NportFiling | null = null;
  for (let index = 0; index < forms.length; index += 1) {
    if ((forms[index] ?? "").toUpperCase() !== "NPORT-P") continue;
    const accession = accessions[index] ?? "";
    const primaryDocument = documents[index] ?? "";
    const filingDate = dates[index] ?? "";
    if (!accession || !primaryDocument) continue;
    if (!best || filingDate > best.filingDate) best = { accession, primaryDocument, filingDate };
  }
  return best;
}

/**
 * Submissions name the styled viewer (`xslFormNPORT-P_X01/primary_doc.xml`).
 * The filed XML is that same file name in the accession directory.
 */
export function fundFilingUrls(cik: string, accession: string, primaryDocument: string): { xml: string; declared: string } {
  const digits = cik.replace(/\D/g, "");
  const base = `https://www.sec.gov/Archives/edgar/data/${String(Number(digits))}/${accession.replace(/-/g, "")}`;
  const declared = primaryDocument.split("/").map((part) => encodeURIComponent(part)).join("/");
  const xmlName = encodeURIComponent(primaryDocument.split("/").pop() ?? primaryDocument);
  return { xml: `${base}/${xmlName}`, declared: `${base}/${declared}` };
}

function deadline(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function fetchResponse(url: string, accept: string, signal: AbortSignal): Promise<Response> {
  return httpFetch(url, { headers: { Accept: accept, "User-Agent": USER_AGENT }, signal });
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetchResponse(url, "application/json", signal);
  if (!response.ok) throw new Error(`Fund holdings request failed (${response.status})`);
  return response.json() as Promise<unknown>;
}

async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_FILING_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(TOO_LARGE);
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).length > MAX_FILING_BYTES) throw new Error(TOO_LARGE);
  return body;
}

async function fetchFilingXml(cik: string, filing: NportFiling, signal: AbortSignal): Promise<string> {
  const urls = fundFilingUrls(cik, filing.accession, filing.primaryDocument);
  const accept = "application/xml, text/xml;q=0.9, */*;q=0.8";
  const first = await fetchResponse(urls.xml, accept, signal);
  if (first.ok) return readCapped(first);
  await first.body?.cancel().catch(() => undefined);
  if (first.status !== 404 || urls.xml === urls.declared) {
    throw new Error(`Fund holdings request failed (${first.status})`);
  }
  const second = await fetchResponse(urls.declared, accept, signal);
  if (!second.ok) throw new Error(`Fund holdings request failed (${second.status})`);
  return readCapped(second);
}

export async function fetchFundPortfolio(ticker: string, signal?: AbortSignal): Promise<FundPortfolio> {
  const symbol = ticker.trim().toUpperCase().replace(/^\$+/, "");
  if (!symbol) throw new Error(NO_FILING);
  const timed = deadline(signal);
  const cik = cikForTicker(await fetchJson(TICKERS_URL, timed), symbol);
  if (!cik) throw new Error(NO_FILING);
  const filing = latestNportFiling(await fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`, timed));
  if (!filing) throw new Error(NO_FILING);
  return { ...parseHoldings(await fetchFilingXml(cik, filing, timed)), ticker: symbol };
}
