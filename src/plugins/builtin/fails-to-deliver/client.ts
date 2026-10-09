import { httpFetch } from "../../../utils/http-transport";
import { readZipTexts } from "../shared/zip-text";
import {
  FAIL_LIMIT,
  failSymbol,
  type FailRow,
  type FailsReport,
} from "./model";

/** The listing answers 403 unless the agent names a contact. */
const USER_AGENT = "gloomberb research lucas@kohor.st";

const PAGE_URL = "https://www.sec.gov/data-research/sec-markets-data/fails-deliver-data";
const FETCH_TIMEOUT_MS = 20_000;
/** Half-month archives are about 2 MB. Anything larger is refused before it is kept. */
const MAX_ZIP_BYTES = 8 * 1024 * 1024;
const MAX_PAGE_CHARS = 2_000_000;

const ZIP_HREF = /href\s*=\s*["']([^"']*cnsfails[^"']*\.zip)["']/gi;

export function newestFailsZipUrl(html: string): string {
  let bestKey = "";
  let bestHref = "";
  for (const match of html.matchAll(ZIP_HREF)) {
    const href = match[1]?.replaceAll("&amp;", "&");
    if (!href) continue;
    const name = href.slice(href.lastIndexOf("/") + 1);
    const dated = /cnsfails(\d{6})([a-z])/i.exec(name);
    if (!dated) continue;
    const key = `${dated[1]}${dated[2]!.toLowerCase()}`;
    if (key > bestKey) {
      bestKey = key;
      bestHref = href;
    }
  }
  if (!bestHref) throw new Error("No fails file was listed");
  return new URL(bestHref, PAGE_URL).href;
}

function settlementDay(value: string): string | null {
  const raw = value.trim();
  if (!/^\d{8}$/.test(raw)) return null;
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

function parseQuantity(value: string): number | null {
  const cleaned = value.trim().replace(/,/g, "");
  if (!/^\d+$/.test(cleaned)) return null;
  const quantity = Number(cleaned);
  return Number.isSafeInteger(quantity) ? quantity : null;
}

/** A missing prior close is a dot or a blank field. */
function parsePrice(value: string): number | null {
  const cleaned = value.trim().replace(/,/g, "");
  if (!cleaned || cleaned === ".") return null;
  const price = Number(cleaned);
  return Number.isFinite(price) ? price : null;
}

function splitCsv(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index]!;
    if (quoted) {
      if (char === "\"") {
        if (line[index + 1] === "\"") {
          current += "\"";
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
    } else if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function consider(rows: FailRow[], row: FailRow, limit: number) {
  if (limit <= 0) return;
  const existing = rows.findIndex((item) => item.id === row.id);
  if (existing >= 0) {
    if (row.quantity > rows[existing]!.quantity) rows[existing] = row;
    return;
  }
  if (rows.length < limit) {
    rows.push(row);
    return;
  }
  let smallest = 0;
  for (let index = 1; index < rows.length; index++) {
    if (rows[index]!.quantity < rows[smallest]!.quantity) smallest = index;
  }
  if (row.quantity > rows[smallest]!.quantity) rows[smallest] = row;
}

/**
 * Pipe or comma rows: settlement date, CUSIP, symbol, quantity, description, price.
 * A symbol filter applies before the balance cap, and only that many rows are kept.
 */
export function parseFails(text: string, options?: { symbol?: string; limit?: number }): FailsReport {
  const symbol = failSymbol(options?.symbol);
  const limit = options?.limit ?? FAIL_LIMIT;
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: FailRow[] = [];
  let settlementDate = "";
  let delimiter: "|" | "," | null = null;
  let start = 0;
  while (start <= source.length) {
    const end = source.indexOf("\n", start);
    const lineEnd = end === -1 ? source.length : end;
    let line = source.slice(start, lineEnd);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    start = end === -1 ? source.length + 1 : end + 1;
    if (!line) continue;
    if (!delimiter) delimiter = line.includes("|") ? "|" : ",";
    const fields = delimiter === "|" ? line.split("|") : splitCsv(line);
    const date = settlementDay(fields[0] ?? "");
    if (!date) continue;
    const cusip = (fields[1] ?? "").trim();
    const rowSymbol = failSymbol(fields[2] ?? "");
    if (symbol && rowSymbol !== symbol) continue;
    const quantity = parseQuantity(fields[3] ?? "");
    if (quantity == null) continue;
    if (date > settlementDate) settlementDate = date;
    consider(rows, {
      id: `${date}|${cusip}|${rowSymbol}`,
      symbol: rowSymbol,
      description: (fields[4] ?? "").trim(),
      quantity,
      price: parsePrice(fields[5] ?? ""),
      date,
    }, limit);
  }
  rows.sort((a, b) => b.quantity - a.quantity || a.symbol.localeCompare(b.symbol) || b.date.localeCompare(a.date));
  return { rows, settlementDate: settlementDate || null };
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function request(url: string, signal?: AbortSignal): Promise<Response> {
  const response = await httpFetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/zip,application/octet-stream,*/*",
    },
    signal: requestSignal(signal),
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function zipView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function findEocd(view: DataView): number {
  const start = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let offset = view.byteLength - 22; offset >= start; offset--) {
    if (view.getUint32(offset, true) === EOCD) return offset;
  }
  return -1;
}

/**
 * These archives set the data-descriptor bit and leave the local sizes empty.
 * readZipTexts needs the sizes in the local header; the central directory has them.
 */
function writeLocalSizes(bytes: Uint8Array): void {
  const view = zipView(bytes);
  const eocd = findEocd(view);
  if (eocd < 0) return;
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  for (let index = 0; index < count; index++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== CENTRAL) return;
    const crc = view.getUint32(offset + 16, true);
    const compressed = view.getUint32(offset + 20, true);
    const uncompressed = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    if (compressed === 0xffffffff || uncompressed === 0xffffffff) {
      throw new Error("The file could not be read");
    }
    if (local + 30 <= bytes.length && view.getUint32(local, true) === LOCAL) {
      const flags = view.getUint16(local + 6, true);
      if ((flags & 0x8) && view.getUint32(local + 18, true) === 0) {
        view.setUint16(local + 6, flags & ~0x8, true);
        view.setUint32(local + 14, crc, true);
        view.setUint32(local + 18, compressed, true);
        view.setUint32(local + 22, uncompressed, true);
      }
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
}

export async function readArchiveText(bytes: Uint8Array): Promise<string> {
  writeLocalSizes(bytes);
  const entries = await readZipTexts(bytes);
  const text = entries.find((entry) => entry.name.toLowerCase().endsWith(".txt"))?.text ?? entries[0]?.text;
  if (!text) throw new Error("The file could not be read");
  return text;
}

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new Error("The file is too large");
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error("The file is too large");
    return bytes;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.byteLength) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("The file is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function fetchFails(symbol?: string, signal?: AbortSignal): Promise<FailsReport> {
  const page = await request(PAGE_URL, signal);
  const html = await page.text();
  if (html.length > MAX_PAGE_CHARS) throw new Error("The file is too large");
  const zip = await request(newestFailsZipUrl(html), signal);
  const bytes = await readCapped(zip, MAX_ZIP_BYTES);
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error("The file could not be read");
  }
  return parseFails(await readArchiveText(bytes), { symbol });
}
