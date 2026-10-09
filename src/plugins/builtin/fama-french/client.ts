import { httpFetch } from "../../../utils/http-transport";
import { readZipTexts } from "../shared/zip-text";
import { FACTOR_MONTHS, type FactorMonth, type FactorReturns } from "./model";

const FACTORS_URL = "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_Factors_CSV.zip";
const FETCH_TIMEOUT_MS = 15_000;
const VINTAGE = /[^.]*created using the \d{6} CRSP database[^.]*\./i;

interface FactorColumns {
  market: number;
  size: number;
  value: number;
  rf: number;
}

function cells(line: string): string[] {
  return line.split(",").map((cell) => cell.trim());
}

function crspVintage(preamble: string): string {
  const sentence = preamble.replace(/\s+/g, " ").trim().match(VINTAGE)?.[0]?.trim();
  if (!sentence) throw new Error("Factor file had no CRSP vintage");
  return sentence;
}

function columnIndexes(header: string): FactorColumns {
  const names = cells(header).map((cell) => cell.toLowerCase());
  const at = (name: string) => {
    const index = names.indexOf(name);
    if (index < 0) throw new Error("Factor file was not recognized");
    return index;
  };
  return { market: at("mkt-rf"), size: at("smb"), value: at("hml"), rf: at("rf") };
}

function monthlyRow(line: string, columns: FactorColumns): FactorMonth | null {
  const fields = cells(line);
  const month = fields[0] ?? "";
  if (!/^\d{6}$/.test(month)) return null;
  const marketMinusRf = Number(fields[columns.market]);
  const size = Number(fields[columns.size]);
  const value = Number(fields[columns.value]);
  const rf = Number(fields[columns.rf]);
  if (![marketMinusRf, size, value, rf].every((entry) => Number.isFinite(entry))) return null;
  return { month, marketMinusRf, size, value, rf };
}

export function parseFactorCsv(text: string): FactorReturns {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => {
    const names = cells(line).map((cell) => cell.toLowerCase());
    return names.includes("mkt-rf") && names.includes("smb") && names.includes("hml") && names.includes("rf");
  });
  if (headerIndex < 0) throw new Error("Factor file had no monthly table");
  const columns = columnIndexes(lines[headerIndex]!);
  const months: FactorMonth[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (!line.trim()) break;
    const row = monthlyRow(line, columns);
    if (!row) break;
    months.push(row);
  }
  if (months.length === 0) throw new Error("Factor file had no monthly rows");
  return {
    vintage: crspVintage(lines.slice(0, headerIndex).join("\n")),
    months: months.slice(-FACTOR_MONTHS).reverse(),
  };
}

export async function fetchFactorReturns(signal?: AbortSignal): Promise<FactorReturns> {
  const response = await httpFetch(FACTORS_URL, {
    headers: {
      Accept: "application/zip, application/octet-stream;q=0.9, */*;q=0.8",
      "User-Agent": "gloomberb",
    },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)])
      : AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Factor returns request failed (${response.status})`);
  const entries = await readZipTexts(new Uint8Array(await response.arrayBuffer()));
  const csv = entries.find((entry) => entry.name.toLowerCase().endsWith(".csv"));
  if (!csv) throw new Error("Factor file was not recognized");
  return parseFactorCsv(csv.text);
}
