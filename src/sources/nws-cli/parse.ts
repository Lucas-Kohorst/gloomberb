import type { NwsCliPrint, NwsCliPrintKind } from "./types";
import { NWS_CLI_PROVIDER_ID } from "./types";

const MONTHS: Readonly<Record<string, string>> = {
  JANUARY: "01",
  FEBRUARY: "02",
  MARCH: "03",
  APRIL: "04",
  MAY: "05",
  JUNE: "06",
  JULY: "07",
  AUGUST: "08",
  SEPTEMBER: "09",
  OCTOBER: "10",
  NOVEMBER: "11",
  DECEMBER: "12",
};

const SUMMARY_DATE_RE =
  /CLIMATE SUMMARY FOR ([A-Z]+) (\d{1,2}) (\d{4})/i;
const CLI_HEADER_RE = /^CLI([A-Z0-9]{2,5})\s*$/m;
const MAX_TEMP_RE = /^\s*MAXIMUM\s+(-?\d+(?:\.\d+)?|M)\b/im;
const MIN_TEMP_RE = /^\s*MINIMUM\s+(-?\d+(?:\.\d+)?|M)\b/im;
const PRECIP_RE = /^\s*PRECIPITATION \(IN\)[\s\S]{0,240}?^\s*(?:YESTERDAY|TODAY)?\s*(-?\d+(?:\.\d+)?|T|M)\b/im;

export function normalizeIcaoStation(token: string): string | null {
  const compact = token.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!compact) return null;
  if (/^[A-Z]{4}$/.test(compact)) return compact;
  if (/^[A-Z]{3}$/.test(compact)) return `K${compact}`;
  if (compact.startsWith("CLI") && compact.length >= 5 && compact.length <= 8) {
    const rest = compact.slice(3);
    return rest.length === 3 ? `K${rest}` : rest.length === 4 ? rest : null;
  }
  return null;
}

export function cliProductCodeForIcao(icao: string): string {
  const id = icao.trim().toUpperCase();
  if (id.startsWith("K") && id.length === 4) return `CLI${id.slice(1)}`;
  return `CLI${id}`;
}

export function parseClimateSummaryDate(text: string): string | null {
  const match = SUMMARY_DATE_RE.exec(text);
  if (!match) return null;
  const month = MONTHS[match[1]!.toUpperCase()];
  const day = match[2]!.padStart(2, "0");
  const year = match[3]!;
  if (!month) return null;
  return `${year}-${month}-${day}`;
}

function parseMaybeNumber(token: string | undefined): number | null {
  if (!token || token === "M") return null;
  if (token === "T") return 0;
  const value = Number(token);
  return Number.isFinite(value) ? value : null;
}

export function detectCliPrintKind(text: string): NwsCliPrintKind {
  if (/PRELIMINARY LOCAL CLIMATE DATA/i.test(text)) return "preliminary";
  return "final";
}

export function parseNwsCliProductText(
  text: string,
  options: {
    icao: string;
    issuedAt?: string | null;
    productId?: string | null;
    sourceUrl?: string | null;
  },
): NwsCliPrint | null {
  const icao = normalizeIcaoStation(options.icao);
  if (!icao) return null;
  const header = CLI_HEADER_RE.exec(text);
  const cliProduct = header ? `CLI${header[1]}` : cliProductCodeForIcao(icao);
  const date = parseClimateSummaryDate(text);
  if (!date) return null;
  const maxSection = text.match(/TEMPERATURE \(F\)[\s\S]{0,800}?MINIMUM[\s\S]{0,120}/i)?.[0] ?? text;
  return {
    provider: NWS_CLI_PROVIDER_ID,
    seriesId: icao,
    icao,
    cliProduct,
    date,
    issuedAt: options.issuedAt ?? null,
    printKind: detectCliPrintKind(text),
    highF: parseMaybeNumber(MAX_TEMP_RE.exec(maxSection)?.[1]),
    lowF: parseMaybeNumber(MIN_TEMP_RE.exec(maxSection)?.[1]),
    precipIn: parseMaybeNumber(PRECIP_RE.exec(text)?.[1]),
    productId: options.productId ?? null,
    sourceUrl: options.sourceUrl ?? null,
  };
}

/** Earliest non-preliminary CLI print for a climate date. */
export function firstFinalCliPrint(
  prints: readonly NwsCliPrint[],
  date?: string,
): NwsCliPrint | null {
  const matching = prints.filter((print) => {
    if (print.printKind !== "final") return false;
    if (date && print.date !== date) return false;
    return true;
  });
  if (matching.length === 0) return null;
  return [...matching].sort((left, right) => {
    const leftTs = left.issuedAt ?? "";
    const rightTs = right.issuedAt ?? "";
    if (leftTs !== rightTs) return leftTs.localeCompare(rightTs);
    return left.date.localeCompare(right.date);
  })[0] ?? null;
}
