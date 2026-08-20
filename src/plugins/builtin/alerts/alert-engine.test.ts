import { describe, expect, test } from "bun:test";
import {
  evaluateAlert,
  evaluateExDivAlert,
  evaluateHaltedAlert,
  evaluateShortFloatAlert,
  createAlert,
  serializeAlerts,
  deserializeAlerts,
} from "./alert-engine";
import { parseAlertCommandValues, parseAlertShortcutValues } from "./command";

describe("evaluateAlert", () => {
  test("above: triggers when price exceeds target", () => {
    const alert = createAlert("AAPL", "above", 200);
    expect(evaluateAlert(alert, 199)).toBe(false);
    expect(evaluateAlert(alert, 200)).toBe(false);
    expect(evaluateAlert(alert, 201)).toBe(true);
  });

  test("below: triggers when price drops below target", () => {
    const alert = createAlert("AAPL", "below", 150);
    expect(evaluateAlert(alert, 151)).toBe(false);
    expect(evaluateAlert(alert, 150)).toBe(false);
    expect(evaluateAlert(alert, 149)).toBe(true);
  });

  test("crosses: triggers when price crosses target in either direction", () => {
    const alert = createAlert("AAPL", "crosses", 180);
    expect(evaluateAlert(alert, 175)).toBe(false);
    alert.lastCheckedPrice = 175;
    expect(evaluateAlert(alert, 185)).toBe(true);
  });

  test("crosses: triggers downward crossing", () => {
    const alert = createAlert("AAPL", "crosses", 180);
    alert.lastCheckedPrice = 185;
    expect(evaluateAlert(alert, 175)).toBe(true);
  });

  test("crosses: does not trigger without prior price", () => {
    const alert = createAlert("AAPL", "crosses", 180);
    expect(evaluateAlert(alert, 185)).toBe(false);
  });

  test("does not evaluate triggered alerts", () => {
    const alert = createAlert("AAPL", "above", 200);
    alert.status = "triggered";
    expect(evaluateAlert(alert, 999)).toBe(false);
  });
});

describe("serializeAlerts / deserializeAlerts", () => {
  test("roundtrips alerts", () => {
    const alerts = [createAlert("AAPL", "above", 200), createAlert("TSLA", "below", 100)];
    const json = serializeAlerts(alerts);
    const restored = deserializeAlerts(json);
    expect(restored).toHaveLength(2);
    expect(restored[0]!.symbol).toBe("AAPL");
    expect(restored[1]!.symbol).toBe("TSLA");
  });

  test("keeps halt / short / ex-div conditions", () => {
    const json = serializeAlerts([
      createAlert("AAPL", "halted", 0),
      createAlert("AAPL", "short_float", 5),
      createAlert("AAPL", "ex_div", 7),
    ]);
    expect(deserializeAlerts(json).map((alert) => alert.condition)).toEqual([
      "halted",
      "short_float",
      "ex_div",
    ]);
  });
});

describe("non-price alerts", () => {
  test("halted fires only for an active halt on that ticker", () => {
    const alert = createAlert("AAPL", "halted", 0);
    expect(evaluateHaltedAlert(alert, new Set(["MSFT"]))).toBe(false);
    expect(evaluateHaltedAlert(alert, new Set(["AAPL"]))).toBe(true);
    expect(evaluateAlert(alert, 1)).toBe(false);
  });

  test("short float fires at or above the threshold", () => {
    const alert = createAlert("AAPL", "short_float", 5);
    expect(evaluateShortFloatAlert(alert, 4.9)).toBe(false);
    expect(evaluateShortFloatAlert(alert, 5)).toBe(true);
    expect(evaluateShortFloatAlert(alert, null)).toBe(false);
  });

  test("ex-div fires when the next ex-date is within N days and not in the past", () => {
    const alert = createAlert("AAPL", "ex_div", 7);
    const now = new Date("2026-08-18T12:00:00.000Z");
    expect(evaluateExDivAlert(alert, new Date("2026-08-25T00:00:00.000Z"), now)).toBe(true);
    expect(evaluateExDivAlert(alert, new Date("2026-08-26T00:00:00.000Z"), now)).toBe(false);
    expect(evaluateExDivAlert(alert, new Date("2026-08-17T00:00:00.000Z"), now)).toBe(false);
  });
});

describe("alert command parser", () => {
  test("parses halted, short %, and ex-div shortcuts", () => {
    expect(parseAlertShortcutValues("AAPL halted")).toEqual({
      symbol: "AAPL",
      condition: "halted",
    });
    expect(parseAlertCommandValues(parseAlertShortcutValues("AAPL halted"))).toEqual({
      symbol: "AAPL",
      condition: "halted",
      price: 0,
    });
    expect(parseAlertShortcutValues("AAPL short 5")).toEqual({
      symbol: "AAPL",
      condition: "short_float",
      price: "5",
    });
    expect(parseAlertShortcutValues("AAPL exdiv 7")).toEqual({
      symbol: "AAPL",
      condition: "ex_div",
      price: "7",
    });
  });
});
