import { afterEach, describe, expect, test } from "bun:test";
import {
  listConnectionSources,
  setConnectionRequestReporter,
  clearPendingConnectionReports,
} from "../connections/register";
import {
  HKO_RAINFALL_CONNECTION_ID,
  WEATHER_SOURCE_DEFS,
  WEATHER_UNDERGROUND_CONNECTION_ID,
  registerWeatherSources,
  weatherSourceDef,
} from "./sources";
import {
  NWS_CLI_CONNECTION_ID,
  NWS_OBSERVATIONS_CONNECTION_ID,
  WEATHER_CONNECTION_ID,
} from "./types";

describe("weather source metadata", () => {
  const disposers: Array<() => void> = [];

  afterEach(() => {
    setConnectionRequestReporter(null);
    clearPendingConnectionReports();
    while (disposers.length > 0) disposers.pop()?.();
  });

  test("lists every weather feed in priority order", () => {
    const ids = WEATHER_SOURCE_DEFS.map((def) => def.id);
    expect(ids).toEqual([
      WEATHER_CONNECTION_ID,
      NWS_CLI_CONNECTION_ID,
      NWS_OBSERVATIONS_CONNECTION_ID,
      HKO_RAINFALL_CONNECTION_ID,
      WEATHER_UNDERGROUND_CONNECTION_ID,
    ]);
    expect(WEATHER_SOURCE_DEFS.map((def) => def.priority)).toEqual(
      [...WEATHER_SOURCE_DEFS.map((def) => def.priority!)].sort((a, b) => a - b),
    );
  });

  test("HKO is keyless and Weather Underground requires an API key", () => {
    expect(weatherSourceDef(HKO_RAINFALL_CONNECTION_ID)?.authRequired).toBe(false);
    expect(weatherSourceDef(WEATHER_UNDERGROUND_CONNECTION_ID)?.authRequired).toBe(true);
  });

  test("registerWeatherSources only adds rows for the owned international feeds", () => {
    clearPendingConnectionReports();
    const before = listConnectionSources().map((def) => def.id);
    disposers.push(...registerWeatherSources());
    const after = listConnectionSources().map((def) => def.id);
    expect(after).toContain(HKO_RAINFALL_CONNECTION_ID);
    expect(after).toContain(WEATHER_UNDERGROUND_CONNECTION_ID);
    // Adjacent Cloud children are not re-registered as their own rows.
    expect(after.filter((id) => id === WEATHER_CONNECTION_ID)).toHaveLength(
      before.filter((id) => id === WEATHER_CONNECTION_ID).length,
    );
    expect(after.filter((id) => id === NWS_CLI_CONNECTION_ID)).toHaveLength(
      before.filter((id) => id === NWS_CLI_CONNECTION_ID).length,
    );
  });

  test("disposing the registered sources removes them from the registry", () => {
    clearPendingConnectionReports();
    const dispose = registerWeatherSources();
    expect(listConnectionSources().some((def) => def.id === HKO_RAINFALL_CONNECTION_ID)).toBe(true);
    for (const fn of dispose) fn();
    expect(listConnectionSources().some((def) => def.id === HKO_RAINFALL_CONNECTION_ID)).toBe(false);
    expect(listConnectionSources().some((def) => def.id === WEATHER_UNDERGROUND_CONNECTION_ID)).toBe(false);
  });
});
