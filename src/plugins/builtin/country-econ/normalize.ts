import { WORLD_BANK_REGION_CODES } from "./indicators";
import type { CountryEconKind, CountryEconRow } from "./types";

interface WorldBankObservation {
  indicator?: { id?: string; value?: string };
  country?: { id?: string; value?: string };
  countryiso3code?: string;
  date?: string;
  value?: number | null;
}

export function parseWorldBankPayload(payload: unknown, unit: string): CountryEconRow[] {
  if (!Array.isArray(payload) || payload.length < 2 || !Array.isArray(payload[1])) return [];
  const rows: CountryEconRow[] = [];
  for (const entry of payload[1] as WorldBankObservation[]) {
    const iso3 = (entry.countryiso3code ?? "").trim().toUpperCase();
    const name = (entry.country?.value ?? iso3).trim();
    if (!iso3 || iso3.length !== 3) continue;
    const kind: CountryEconKind = WORLD_BANK_REGION_CODES.has(iso3) ? "region" : "country";
    rows.push({
      id: iso3,
      iso3,
      name,
      kind,
      region: kind === "region" ? name : (entry.country?.id ?? ""),
      year: String(entry.date ?? ""),
      value: typeof entry.value === "number" && Number.isFinite(entry.value) ? entry.value : null,
      unit,
      indicator: entry.indicator?.id ?? "",
    });
  }
  return rows;
}

export function matchesCountryEconSearch(row: CountryEconRow, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return (
    row.iso3.toLowerCase().includes(normalized)
    || row.name.toLowerCase().includes(normalized)
    || row.kind.includes(normalized)
    || row.year.includes(normalized)
  );
}
