/**
 * Decode 6-hour and 24-hour temperature groups from a METAR remarks section.
 *
 * FMH-1: `1sTTT` / `2sTTT` are 6-hour max/min in tenths of °C. `4sTTTsTTT`
 * is 24-hour max then min. `s` is 0 for positive, 1 for negative.
 */

export interface MetarExtremes {
  maxF6h: number | null;
  minF6h: number | null;
  maxF24h: number | null;
  minF24h: number | null;
}

export function observationKindFromRaw(rawMessage: string | null | undefined): "metar" | "speci" | "other" {
  const text = rawMessage?.trim() ?? "";
  if (/^SPECI\b/i.test(text)) return "speci";
  if (/^METAR\b/i.test(text) || /^[A-Z]{4}\s+\d{6}Z/.test(text)) return "metar";
  return "other";
}

function tenthsCToF(sign: string, tenths: string): number | null {
  if (!/^\d{3}$/.test(tenths)) return null;
  const celsius = (sign === "1" ? -1 : 1) * Number(tenths) / 10;
  if (!Number.isFinite(celsius)) return null;
  return Math.round((celsius * 9) / 5 + 32);
}

export function parseMetarRemarks(rawMessage: string | null | undefined): MetarExtremes {
  const empty: MetarExtremes = { maxF6h: null, minF6h: null, maxF24h: null, minF24h: null };
  if (!rawMessage) return empty;
  const remarksIndex = rawMessage.search(/\bRMK\b/);
  const remarks = remarksIndex >= 0 ? rawMessage.slice(remarksIndex) : rawMessage;
  const sixMax = /\b1([01])(\d{3})\b/.exec(remarks);
  const sixMin = /\b2([01])(\d{3})\b/.exec(remarks);
  const day = /\b4([01])(\d{3})([01])(\d{3})\b/.exec(remarks);
  return {
    maxF6h: sixMax ? tenthsCToF(sixMax[1]!, sixMax[2]!) : null,
    minF6h: sixMin ? tenthsCToF(sixMin[1]!, sixMin[2]!) : null,
    maxF24h: day ? tenthsCToF(day[1]!, day[2]!) : null,
    minF24h: day ? tenthsCToF(day[3]!, day[4]!) : null,
  };
}
