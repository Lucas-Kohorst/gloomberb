import type { FireHotspot } from "./types";

function num(value: string | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCsvLine(line: string): string[] {
  return line.split(",").map((cell) => cell.trim());
}

/**
 * FIRMS 24h VIIRS CSV. Header names vary slightly across products; we key
 * by normalized header rather than column index.
 */
export function parseFirmsCsv(text: string): FireHotspot[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]!).map((cell) => cell.toLowerCase());
  const index = (name: string): number => header.indexOf(name);
  const latIdx = index("latitude");
  const lonIdx = index("longitude");
  if (latIdx < 0 || lonIdx < 0) return [];

  const brightIdx = Math.max(index("bright_ti4"), index("brightness"));
  const frpIdx = index("frp");
  const satIdx = index("satellite");
  const confIdx = index("confidence");
  const dateIdx = index("acq_date");
  const timeIdx = index("acq_time");
  const dayIdx = index("daynight");
  const hotspots: FireHotspot[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]!);
    const lat = num(cells[latIdx]);
    const lon = num(cells[lonIdx]);
    if (lat == null || lon == null) continue;
    const acqDate = cells[dateIdx] ?? "";
    const acqTime = cells[timeIdx] ?? "";
    const satellite = cells[satIdx] || "VIIRS";
    hotspots.push({
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
    });
  }
  return hotspots;
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
