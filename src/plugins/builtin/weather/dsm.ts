import { withConnectionRequest } from "../connections/register";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { httpFetch } from "../../../utils/http-transport";
import { NWS_OBSERVATIONS_CONNECTION_ID } from "./types";
import { nwsIcaoForStation } from "./nws-client";

export interface DsmPrint {
  icao: string;
  date: string;
  issuedAt: string | null;
  validAsOfLocal: string | null;
  highF: number | null;
  lowF: number | null;
  highTimeLocal: string | null;
  lowTimeLocal: string | null;
  sourceUrl: string | null;
  raw: string;
}

const MONTHS: Readonly<Record<string, string>> = {
  JANUARY: "01", FEBRUARY: "02", MARCH: "03", APRIL: "04", MAY: "05", JUNE: "06",
  JULY: "07", AUGUST: "08", SEPTEMBER: "09", OCTOBER: "10", NOVEMBER: "11", DECEMBER: "12",
};

const SUMMARY_DATE_RE = /CLIMATE SUMMARY FOR ([A-Z]+) (\d{1,2}) (\d{4})/i;
const VALID_RE = /VALID AS OF\s+(\d{1,4}\s*(?:AM|PM)\s+LOCAL TIME)/i;
const MAX_RE = /^\s*MAXIMUM\s+(-?\d+|M)\s+(\d{3,4}\s*(?:AM|PM))?/im;
const MIN_RE = /^\s*MINIMUM\s+(-?\d+|M)\s+(\d{3,4}\s*(?:AM|PM))?/im;

const DSM_FETCH = createThrottledFetch({
  requestsPerMinute: 20,
  maxRetries: 2,
  timeoutMs: 12_000,
  backoffBaseMs: 400,
  dedupeGetRequests: true,
  defaultHeaders: { "User-Agent": "Gloomberb weather (https://terminal.kohor.st)" },
  transport: httpFetch,
});

function parseMaybeNumber(token: string | undefined): number | null {
  if (!token || token === "M") return null;
  const value = Number(token);
  return Number.isFinite(value) ? value : null;
}

export function parseDsmProductText(text: string, icao: string): DsmPrint | null {
  const dateMatch = SUMMARY_DATE_RE.exec(text);
  if (!dateMatch) return null;
  const month = MONTHS[dateMatch[1]!.toUpperCase()];
  if (!month) return null;
  const date = `${dateMatch[3]}-${month}-${dateMatch[2]!.padStart(2, "0")}`;
  const todayIndex = text.search(/^\s*TODAY\s*$/im);
  const section = todayIndex >= 0 ? text.slice(todayIndex) : text;
  const max = MAX_RE.exec(section);
  const min = MIN_RE.exec(section);
  return {
    icao,
    date,
    issuedAt: null,
    validAsOfLocal: VALID_RE.exec(text)?.[1]?.replace(/\s+/g, " ") ?? null,
    highF: parseMaybeNumber(max?.[1]),
    lowF: parseMaybeNumber(min?.[1]),
    highTimeLocal: max?.[2]?.trim() ?? null,
    lowTimeLocal: min?.[2]?.trim() ?? null,
    sourceUrl: null,
    raw: text,
  };
}

function splitAfosProducts(body: string): string[] {
  const chunks = body.split(/\n(?=\x01|\d{3}\r?\n|[A-Z]{4}\d{2}\s+[A-Z]{4}\s+\d{6})/);
  return chunks.map((chunk) => chunk.replace(/^\x01/, "").trim()).filter((chunk) => chunk.length > 40);
}

export async function loadDsmPrints(icaoOrStation: string, limit = 6): Promise<DsmPrint[]> {
  const icao = nwsIcaoForStation(icaoOrStation);
  if (!icao) throw new Error("Unknown ICAO station for DSM.");
  const pil = `DSM${icao.startsWith("K") && icao.length === 4 ? icao.slice(1) : icao}`;
  const url = `https://mesonet.agron.iastate.edu/cgi-bin/afos/retrieve.py?pil=${encodeURIComponent(pil)}&limit=${limit}&fmt=text`;
  const text = await withConnectionRequest(NWS_OBSERVATIONS_CONNECTION_ID, "dsm", async () => {
    const response = await DSM_FETCH.fetch(url);
    if (!response.ok) throw new Error(`DSM fetch failed (${response.status}).`);
    return response.text();
  });
  const prints: DsmPrint[] = [];
  for (const chunk of splitAfosProducts(text)) {
    const parsed = parseDsmProductText(chunk, icao);
    if (parsed) prints.push({ ...parsed, sourceUrl: url });
  }
  if (prints.length === 0) {
    const parsed = parseDsmProductText(text, icao);
    if (parsed) prints.push({ ...parsed, sourceUrl: url });
  }
  return prints;
}
