import type { WeatherScope, WeatherStation } from "./types";

const DOMESTIC: ReadonlyArray<Omit<WeatherStation, "scope" | "aliases"> & { aliases?: string[] }> = [
  { id: "ATL", city: "Atlanta", country: "United States", icao: "KATL", timezone: "America/New_York" },
  { id: "AUS", city: "Austin", country: "United States", icao: "KAUS", timezone: "America/Chicago" },
  { id: "BOS", city: "Boston", country: "United States", icao: "KBOS", timezone: "America/New_York" },
  { id: "DCA", city: "Washington, DC", country: "United States", icao: "KDCA", timezone: "America/New_York", aliases: ["DC", "WAS"] },
  { id: "DEN", city: "Denver", country: "United States", icao: "KDEN", timezone: "America/Denver" },
  { id: "DFW", city: "Dallas", country: "United States", icao: "KDFW", timezone: "America/Chicago" },
  { id: "GNV", city: "Gainesville", country: "United States", icao: "KGNV", timezone: "America/New_York" },
  { id: "HOU", city: "Houston (Hobby)", country: "United States", icao: "KHOU", timezone: "America/Chicago" },
  { id: "IAH", city: "Houston (Bush Intercontinental)", country: "United States", icao: "KIAH", timezone: "America/Chicago" },
  { id: "JAX", city: "Jacksonville", country: "United States", icao: "KJAX", timezone: "America/New_York" },
  { id: "LAS", city: "Las Vegas", country: "United States", icao: "KLAS", timezone: "America/Los_Angeles" },
  { id: "LAX", city: "Los Angeles", country: "United States", icao: "KLAX", timezone: "America/Los_Angeles" },
  { id: "MDW", city: "Chicago (Midway)", country: "United States", icao: "KMDW", timezone: "America/Chicago", aliases: ["CHI"] },
  { id: "MIA", city: "Miami", country: "United States", icao: "KMIA", timezone: "America/New_York" },
  { id: "MSP", city: "Minneapolis", country: "United States", icao: "KMSP", timezone: "America/Chicago" },
  { id: "MSY", city: "New Orleans", country: "United States", icao: "KMSY", timezone: "America/Chicago" },
  { id: "NYC", city: "New York City", country: "United States", icao: "KNYC", timezone: "America/New_York", aliases: ["NY"] },
  { id: "OKC", city: "Oklahoma City", country: "United States", icao: "KOKC", timezone: "America/Chicago" },
  { id: "ORD", city: "Chicago (O'Hare)", country: "United States", icao: "KORD", timezone: "America/Chicago" },
  { id: "PHL", city: "Philadelphia", country: "United States", icao: "KPHL", timezone: "America/New_York", aliases: ["PHIL"] },
  { id: "PHX", city: "Phoenix", country: "United States", icao: "KPHX", timezone: "America/Phoenix" },
  { id: "SAN", city: "San Diego", country: "United States", icao: "KSAN", timezone: "America/Los_Angeles" },
  { id: "SAT", city: "San Antonio", country: "United States", icao: "KSAT", timezone: "America/Chicago" },
  { id: "SEA", city: "Seattle", country: "United States", icao: "KSEA", timezone: "America/Los_Angeles" },
  { id: "SFO", city: "San Francisco", country: "United States", icao: "KSFO", timezone: "America/Los_Angeles" },
  { id: "SPG", city: "St. Petersburg", country: "United States", icao: "KSPG", timezone: "America/New_York" },
  { id: "TPA", city: "Tampa", country: "United States", icao: "KTPA", timezone: "America/New_York" },
];

const INTERNATIONAL: ReadonlyArray<Omit<WeatherStation, "scope" | "aliases"> & { aliases?: string[] }> = [
  { id: "YYZ", city: "Toronto", country: "Canada", icao: "CYYZ", timezone: "America/Toronto", region: "Americas" },
  { id: "BRU", city: "Brussels", country: "Belgium", icao: "EBBR", timezone: "Europe/Brussels", region: "Europe" },
  { id: "BER", city: "Berlin", country: "Germany", icao: "EDDB", timezone: "Europe/Berlin", region: "Europe" },
  { id: "FRA", city: "Frankfurt", country: "Germany", icao: "EDDF", timezone: "Europe/Berlin", region: "Europe" },
  { id: "LHR", city: "London", country: "United Kingdom", icao: "EGLL", timezone: "Europe/London", region: "Europe" },
  { id: "AMS", city: "Amsterdam", country: "Netherlands", icao: "EHAM", timezone: "Europe/Amsterdam", region: "Europe" },
  { id: "CDG", city: "Paris", country: "France", icao: "LFPG", timezone: "Europe/Paris", region: "Europe" },
  { id: "GVA", city: "Geneva", country: "Switzerland", icao: "LSGG", timezone: "Europe/Zurich", region: "Europe" },
  { id: "IST", city: "Istanbul", country: "Turkey", icao: "LTFM", timezone: "Europe/Istanbul", region: "Europe" },
  { id: "MEX", city: "Mexico City", country: "Mexico", icao: "MMMX", timezone: "America/Mexico_City", region: "Americas" },
  { id: "DXB", city: "Dubai", country: "United Arab Emirates", icao: "OMDB", timezone: "Asia/Dubai", region: "Middle East" },
  { id: "HND", city: "Tokyo", country: "Japan", icao: "RJTT", timezone: "Asia/Tokyo", region: "Asia" },
  { id: "ICN", city: "Seoul", country: "South Korea", icao: "RKSI", timezone: "Asia/Seoul", region: "Asia" },
  { id: "GMP", city: "Seoul", country: "South Korea", icao: "RKSS", timezone: "Asia/Seoul", region: "Asia" },
  { id: "GRU", city: "São Paulo", country: "Brazil", icao: "SBGR", timezone: "America/Sao_Paulo", region: "Americas" },
  { id: "BOM", city: "Mumbai", country: "India", icao: "VABB", timezone: "Asia/Kolkata", region: "Asia" },
  { id: "HKG", city: "Hong Kong", country: "Hong Kong", icao: "VHHH", timezone: "Asia/Hong_Kong", region: "Asia" },
  { id: "SIN", city: "Singapore", country: "Singapore", icao: "WSSS", timezone: "Asia/Singapore", region: "Asia" },
  { id: "SYD", city: "Sydney", country: "Australia", icao: "YSSY", timezone: "Australia/Sydney", region: "Oceania" },
  { id: "PEK", city: "Beijing", country: "China", icao: "ZBAA", timezone: "Asia/Shanghai", region: "Asia" },
  { id: "PVG", city: "Shanghai", country: "China", icao: "ZSPD", timezone: "Asia/Shanghai", region: "Asia" },
];

function toStation(
  entry: Omit<WeatherStation, "scope" | "aliases"> & { aliases?: string[] },
  scope: WeatherScope,
): WeatherStation {
  const aliases = new Set<string>([
    entry.id,
    `CLI${entry.id}`,
    entry.icao,
    ...(entry.aliases ?? []),
  ]);
  return { ...entry, scope, aliases: [...aliases] };
}

export const WEATHER_STATIONS: readonly WeatherStation[] = [
  ...DOMESTIC.map((entry) => toStation(entry, "domestic")),
  ...INTERNATIONAL.map((entry) => toStation(entry, "international")),
];

const STATION_BY_TOKEN = new Map<string, WeatherStation>();
for (const station of WEATHER_STATIONS) {
  for (const alias of station.aliases) {
    STATION_BY_TOKEN.set(compactStationToken(alias), station);
  }
}

export function compactStationToken(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Normalize `CLILAX` / `KLAX` / `lax` to the TWC climate id (`LAX`). */
export function canonicalWeatherStationId(token: string): string | null {
  const compact = compactStationToken(token);
  if (!compact) return null;
  const known = STATION_BY_TOKEN.get(compact);
  if (known) return known.id;
  if (compact.startsWith("CLI") && compact.length >= 5) {
    return compact.slice(3);
  }
  if (/^K[A-Z]{3}$/.test(compact)) return compact.slice(1);
  if (/^[A-Z]{2,4}$/.test(compact)) return compact;
  return null;
}

export function findWeatherStation(token: string): WeatherStation | undefined {
  const compact = compactStationToken(token);
  if (!compact) return undefined;
  const known = STATION_BY_TOKEN.get(compact);
  if (known) return known;
  const canonical = canonicalWeatherStationId(compact);
  return canonical ? STATION_BY_TOKEN.get(canonical) : undefined;
}

export function cliProductForStation(stationId: string): string {
  const canonical = canonicalWeatherStationId(stationId) ?? compactStationToken(stationId);
  return canonical.startsWith("CLI") ? canonical : `CLI${canonical}`;
}

export function weatherStationLabel(station: Pick<WeatherStation, "city" | "id">): string {
  return `${station.city} (${station.id})`;
}

export function mergeWeatherStation(
  partial: {
    id?: string;
    city?: string;
    country?: string;
    icao?: string;
    timezone?: string;
    region?: string;
    isDomestic?: boolean;
  },
): WeatherStation | null {
  const id = canonicalWeatherStationId(partial.id ?? partial.icao ?? "");
  if (!id) return null;
  const known = findWeatherStation(id) ?? (partial.icao ? findWeatherStation(partial.icao) : undefined);
  const icao = (partial.icao ?? known?.icao ?? (id.length === 3 ? `K${id}` : id)).toUpperCase();
  const scope: WeatherScope = partial.isDomestic === false
    ? "international"
    : known?.scope ?? (icao.startsWith("K") ? "domestic" : "international");
  return {
    id,
    city: partial.city?.trim() || known?.city || id,
    country: partial.country?.trim() || known?.country || (scope === "domestic" ? "United States" : ""),
    icao,
    timezone: partial.timezone?.trim() || known?.timezone || "UTC",
    region: partial.region?.trim() || known?.region,
    scope,
    aliases: known?.aliases ?? [id, `CLI${id}`, icao],
  };
}
