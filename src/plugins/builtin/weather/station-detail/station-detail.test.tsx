import { afterEach, describe, expect, test } from "bun:test";
import { useReducer, type ReactNode } from "react";
import { testRender } from "../../../../renderers/opentui/test-utils";
import { AppContext, appReducer, createInitialState } from "../../../../state/app/context";
import { createDefaultConfig } from "../../../../types/config";
import { StationDetail, stationTrendSummary, type StationObservation } from "./station-detail";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(() => {
  testSetup?.renderer.destroy();
  testSetup = undefined;
});

function TableHarness({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(
    appReducer,
    createInitialState(createDefaultConfig("/tmp/gloom-weather-station-detail-test")),
  );
  return <AppContext value={{ state, dispatch }}>{children}</AppContext>;
}

const observations: StationObservation[] = [
  {
    timestamp: "2026-08-28T12:05:00Z",
    temperatureF: 75,
    dewpointF: 70,
    humidityPct: 83,
    windDirection: "NE",
    windSpeedMph: 3,
    windGustMph: 8,
    visibilityMiles: 10,
    pressureInHg: 29.7,
    precipitationIn: 0,
    skyCondition: "Clear",
    status: "METAR",
  },
  {
    timestamp: "2026-08-28T11:05:00Z",
    temperatureF: 72,
    dewpointF: 69,
    humidityPct: 86,
    windDirection: "N",
    windSpeedMph: 2,
    visibilityMiles: 9,
    pressureInHg: 29.68,
    skyCondition: "Few clouds",
  },
];

describe("StationDetail", () => {
  test("renders a compact current reading, textual trend, and observations", async () => {
    testSetup = await testRender(
      <TableHarness>
        <StationDetail stationLabel="Los Angeles Intl · KLAX" observations={observations} timeZone="UTC" width={86} height={18} />
      </TableHarness>,
      { width: 86, height: 18 },
    );
    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Los Angeles Intl");
    expect(frame).toContain("TEMP");
    expect(frame).toContain("TREND");
    expect(frame).toContain("Temp +3°F");
    expect(frame).toContain("LOCAL");
    expect(frame).toContain("Few clouds");
  });

  test("uses placeholders when station fields are missing", async () => {
    testSetup = await testRender(
      <TableHarness>
        <StationDetail observations={[{ timestamp: null, skyCondition: null }]} width={48} height={12} />
      </TableHarness>,
      { width: 48, height: 12 },
    );
    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Insufficient readings for a trend.");
    expect(frame).toContain("Sky condition unavailable");
    expect(frame).toContain("—");
  });

  test("summarizes only fields with enough valid readings", () => {
    expect(stationTrendSummary([
      { timestamp: "2026-08-28T12:00:00Z", temperatureF: 70 },
      { timestamp: "2026-08-28T11:00:00Z", temperatureF: 70 },
      { timestamp: "not-a-date", humidityPct: 55 },
    ])).toBe("Temp steady across 3 observations");
  });
});
