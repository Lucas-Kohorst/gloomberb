import type { FireHotspot } from "./types";

export const FIRMS_PARSE_CAP = 500;
export const FIRMS_FIRST_PAINT = 120;
export const FIRMS_YIELD_EVERY = 400;

function num(value: string | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCsvLine(line: string): string[] {
  return line.split(",").map((cell) => cell.trim());
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function hotspotFrp(row: FireHotspot): number {
  return row.frp ?? 0;
}

/** Keep the hottest detections so a 24h global CSV cannot flood the table. */
export function keepHottestHotspots(rows: FireHotspot[], cap = FIRMS_PARSE_CAP): FireHotspot[] {
  if (rows.length <= cap) return rows;
  return rows
    .map((row, index) => ({ row, index, frp: hotspotFrp(row) }))
    .sort((a, b) => b.frp - a.frp || a.index - b.index)
    .slice(0, cap)
    .map((entry) => entry.row);
}

export function mergeHotspots(previous: FireHotspot[], next: FireHotspot[]): FireHotspot[] {
  if (previous.length === 0) return next;
  const byId = new Map(previous.map((row) => [row.id, row]));
  let changed = previous.length !== next.length;
  const merged = next.map((row) => {
    const old = byId.get(row.id);
    if (old && old.frp === row.frp && old.brightness === row.brightness && old.acqTime === row.acqTime) {
      return old;
    }
    changed = true;
    return row;
  });
  return changed ? merged : previous;
}

function trimHottest(rows: FireHotspot[], cap: number): void {
  if (rows.length <= cap) return;
  const kept = keepHottestHotspots(rows, cap);
  rows.length = 0;
  for (const row of kept) rows.push(row);
}

function snapshotHottest(rows: FireHotspot[], cap: number): FireHotspot[] {
  const kept = keepHottestHotspots(rows, cap);
  return kept === rows ? rows.slice() : kept;
}

function parseHotspot(
  cells: string[],
  latIdx: number,
  lonIdx: number,
  brightIdx: number,
  frpIdx: number,
  satIdx: number,
  confIdx: number,
  dateIdx: number,
  timeIdx: number,
  dayIdx: number,
): FireHotspot | null {
  const lat = num(cells[latIdx]);
  const lon = num(cells[lonIdx]);
  if (lat == null || lon == null) return null;
  const acqDate = cells[dateIdx] ?? "";
  const acqTime = cells[timeIdx] ?? "";
  const satellite = cells[satIdx] || "VIIRS";
  return {
    id: `${lat.toFixed(3)},${lon.toFixed(3)},${acqDate}${acqTime}`,
    lat,
    lon,
    brightness: brightIdx >= 0 ? num(cells[brightIdx]) : null,
    frp: frpIdx >= 0 ? num(cells[frpIdx]) : null,
    satellite,
    confidence: cells[confIdx] ?? "",
    acqDate,
    acqTime,
    daynight: cells[dayIdx] ?? "",
    url: `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${lon.toFixed(2)},${lat.toFixed(2)},7z`,
  };
}

function firmsHeaderIndex(header: string[]): {
  latIdx: number;
  lonIdx: number;
  brightIdx: number;
  frpIdx: number;
  satIdx: number;
  confIdx: number;
  dateIdx: number;
  timeIdx: number;
  dayIdx: number;
} | null {
  const index = (name: string): number => header.indexOf(name);
  const latIdx = index("latitude");
  const lonIdx = index("longitude");
  if (latIdx < 0 || lonIdx < 0) return null;
  return {
    latIdx,
    lonIdx,
    brightIdx: Math.max(index("bright_ti4"), index("brightness")),
    frpIdx: index("frp"),
    satIdx: index("satellite"),
    confIdx: index("confidence"),
    dateIdx: index("acq_date"),
    timeIdx: index("acq_time"),
    dayIdx: index("daynight"),
  };
}

/**
 * FIRMS 24h VIIRS CSV. Header names vary slightly across products; we key
 * by normalized header rather than column index.
 */
export function parseFirmsCsv(text: string, cap = FIRMS_PARSE_CAP): FireHotspot[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]!).map((cell) => cell.toLowerCase());
  const cols = firmsHeaderIndex(header);
  if (!cols) return [];

  const hotspots: FireHotspot[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const row = parseHotspot(
      parseCsvLine(lines[i]!),
      cols.latIdx,
      cols.lonIdx,
      cols.brightIdx,
      cols.frpIdx,
      cols.satIdx,
      cols.confIdx,
      cols.dateIdx,
      cols.timeIdx,
      cols.dayIdx,
    );
    if (!row) continue;
    hotspots.push(row);
    if (hotspots.length >= cap * 3) trimHottest(hotspots, cap);
  }
  return keepHottestHotspots(hotspots, cap);
}

export async function parseFirmsCsvIncremental(
  text: string,
  options: {
    cap?: number;
    firstPaint?: number;
    yieldEvery?: number;
    onPartial?: (rows: FireHotspot[]) => void;
  } = {},
): Promise<FireHotspot[]> {
  const cap = options.cap ?? FIRMS_PARSE_CAP;
  const firstPaint = options.firstPaint ?? FIRMS_FIRST_PAINT;
  const yieldEvery = options.yieldEvery ?? FIRMS_YIELD_EVERY;
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  await yieldToUi();
  const header = parseCsvLine(lines[0]!).map((cell) => cell.toLowerCase());
  const cols = firmsHeaderIndex(header);
  if (!cols) return [];

  const hotspots: FireHotspot[] = [];
  let painted = false;
  for (let i = 1; i < lines.length; i += 1) {
    const row = parseHotspot(
      parseCsvLine(lines[i]!),
      cols.latIdx,
      cols.lonIdx,
      cols.brightIdx,
      cols.frpIdx,
      cols.satIdx,
      cols.confIdx,
      cols.dateIdx,
      cols.timeIdx,
      cols.dayIdx,
    );
    if (row) {
      hotspots.push(row);
      if (hotspots.length >= cap * 3) trimHottest(hotspots, cap);
      if (!painted && hotspots.length >= firstPaint) {
        painted = true;
        options.onPartial?.(snapshotHottest(hotspots, cap));
      }
    }
    if (i % yieldEvery === 0) await yieldToUi();
  }
  return keepHottestHotspots(hotspots, cap);
}

export function matchesHotspotSearch(row: FireHotspot, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return (
    row.satellite.toLowerCase().includes(normalized)
    || row.confidence.toLowerCase().includes(normalized)
    || row.acqDate.includes(normalized)
    || `${row.lat.toFixed(2)},${row.lon.toFixed(2)}`.includes(normalized)
  );
}
