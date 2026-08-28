import {
  registerConnectionSource,
  type ConnectionSourceDef,
} from "../connections/register";
import {
  NWS_CLI_CONNECTION_ID,
  NWS_OBSERVATIONS_CONNECTION_ID,
  WEATHER_CONNECTION_ID,
  WEATHER_PLUGIN_ID,
} from "./types";

/**
 * Connection source ids for the weather plugin.
 *
 * `twc-kalshi` and `nws-cli` already fold onto the Adjacent Cloud inventory row
 * (see {@link ../../connections/adjacent-cloud}), so they are listed here for
 * metadata completeness but are not re-registered. The international /
 * secondary feeds below own their own Connections-pane rows.
 */
export const HKO_RAINFALL_CONNECTION_ID = "hko-rainfall";
export const WEATHER_UNDERGROUND_CONNECTION_ID = "weather-underground";

/** Every weather feed, in priority order. Used for docs and the registry. */
export const WEATHER_SOURCE_DEFS: readonly ConnectionSourceDef[] = [
  {
    id: WEATHER_CONNECTION_ID,
    name: "Weather Company (Kalshi)",
    kind: "data",
    pluginId: WEATHER_PLUGIN_ID,
    priority: 500,
    authRequired: false,
  },
  {
    id: NWS_CLI_CONNECTION_ID,
    name: "NWS CLI Prints",
    kind: "data",
    pluginId: WEATHER_PLUGIN_ID,
    priority: 510,
    authRequired: false,
  },
  {
    id: NWS_OBSERVATIONS_CONNECTION_ID,
    name: "NOAA/NWS Station Observations",
    kind: "data",
    pluginId: WEATHER_PLUGIN_ID,
    priority: 515,
    authRequired: false,
  },
  {
    id: HKO_RAINFALL_CONNECTION_ID,
    name: "Hong Kong Observatory",
    kind: "data",
    pluginId: WEATHER_PLUGIN_ID,
    priority: 520,
    authRequired: false,
  },
  {
    id: WEATHER_UNDERGROUND_CONNECTION_ID,
    name: "Weather Underground",
    kind: "data",
    pluginId: WEATHER_PLUGIN_ID,
    priority: 540,
    authRequired: true,
  },
];

/** Source ids that own their own Connections row (not Adjacent Cloud children). */
const OWNED_SOURCE_IDS = new Set<string>([
  NWS_OBSERVATIONS_CONNECTION_ID,
  HKO_RAINFALL_CONNECTION_ID,
  WEATHER_UNDERGROUND_CONNECTION_ID,
]);

/**
 * Register the international / secondary weather feeds that need their own
 * Connections-pane row. Adjacent Cloud children (`twc-kalshi`, `nws-cli`) are
 * skipped — `registerConnectionSource` already no-ops them and they fold onto
 * the Adjacent Cloud row.
 *
 * Call from the weather plugin `setup()` and dispose the returned callbacks in
 * `dispose()`.
 */
export function registerWeatherSources(): Array<() => void> {
  const disposers: Array<() => void> = [];
  for (const def of WEATHER_SOURCE_DEFS) {
    if (!OWNED_SOURCE_IDS.has(def.id)) continue;
    disposers.push(registerConnectionSource(def));
  }
  return disposers;
}

export function weatherSourceDef(id: string): ConnectionSourceDef | undefined {
  return WEATHER_SOURCE_DEFS.find((def) => def.id === id);
}
