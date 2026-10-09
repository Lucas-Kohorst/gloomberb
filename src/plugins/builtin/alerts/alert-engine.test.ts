import { describe, expect, test } from "bun:test";
import {
  createAlert,
  deserializeAlerts,
  editAlert,
  evaluateAlert,
  evaluateExDivAlert,
  evaluateHaltedAlert,
  evaluatePctDayAlert,
  evaluateShortFloatAlert,
  formatAlertDescription,
  isAlertSnoozed,
  parseExDividendDate,
  rearmAlert,
  resolveAlertSnooze,
  serializeAlerts,
  snoozeAlert,
} from "./alert-engine";

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

describe("editAlert", () => {
  test("keeps identity, re-arms, and clears trigger/quote lifecycle state", () => {
    const alert = {
      ...createAlert("aapl", "above", 200, "NASDAQ"),
      message: "watch this",
      status: "triggered" as const,
      triggeredAt: 123,
      lastCheckedPrice: 205,
      lastCheckedAt: 124,
      lastCheckError: "boom",
      lastQuoteUpdatedAt: 125,
      lastQuoteSource: "live" as const,
      lastQuoteProviderId: "gloom",
    };

    const edited = editAlert(alert, "aapl", "crosses", 180);

    expect(edited).toEqual({
      id: alert.id,
      symbol: "AAPL",
      exchange: "NASDAQ",
      condition: "crosses",
      targetPrice: 180,
      createdAt: alert.createdAt,
      armedAt: expect.any(Number),
      status: "active",
      message: "watch this",
    });
    // A stale lastCheckedPrice would make `crosses` fire off the previous symbol's baseline.
    expect(evaluateAlert(edited, 185)).toBe(false);
  });

  test("rearming a crosses alert drops the old quote baseline", () => {
    const alert = {
      ...createAlert("AAPL", "crosses", 180),
      armedAt: 1,
      status: "triggered" as const,
      triggeredAt: 123,
      lastCheckedPrice: 185,
    };

    const rearmed = rearmAlert(alert);

    expect(rearmed.status).toBe("active");
    expect(rearmed.lastCheckedPrice).toBeUndefined();
    expect(evaluateAlert(rearmed, 175)).toBe(false);
    // Same id, new arming: the cloud emails a trigger once per id and armedAt.
    expect(rearmed.id).toBe(alert.id);
    expect(rearmed.armedAt!).toBeGreaterThan(alert.armedAt);
  });

  test("drops the exchange when the symbol changes", () => {
    const alert = createAlert("AAPL", "above", 200, "NASDAQ");
    expect(editAlert(alert, "tsla", "above", 200).exchange).toBeUndefined();
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

  test("keeps price alerts and the added conditions", () => {
    const alerts = [
      createAlert("AAPL", "above", 200),
      createAlert("AAPL", "below", 100),
      createAlert("AAPL", "crosses", 180),
      createAlert("AAPL", "halted", 0),
      createAlert("AAPL", "short_float", 5),
      createAlert("AAPL", "ex_div", 7),
      createAlert("AAPL", "pct_day", 5),
    ];
    expect(deserializeAlerts(serializeAlerts(alerts)).map((alert) => alert.condition)).toEqual([
      "above",
      "below",
      "crosses",
      "halted",
      "short_float",
      "ex_div",
      "pct_day",
    ]);
  });

  test("loads alerts persisted before snooze support unchanged", () => {
    const legacy = JSON.stringify([{
      id: "alert-legacy",
      symbol: "AAPL",
      condition: "above",
      targetPrice: 200,
      createdAt: 123,
      status: "active",
      lastCheckedPrice: 201,
    }]);
    const alerts = deserializeAlerts(legacy);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toEqual({
      id: "alert-legacy",
      symbol: "AAPL",
      condition: "above",
      targetPrice: 200,
      createdAt: 123,
      status: "active",
      lastCheckedPrice: 201,
    });
    expect(isAlertSnoozed(alerts[0]!)).toBe(false);

    const snoozed = snoozeAlert(alerts[0]!, 60_000);
    const restored = deserializeAlerts(serializeAlerts([snoozed]));
    expect(restored[0]!.snoozedUntil).toBe(snoozed.snoozedUntil);
    expect(isAlertSnoozed(restored[0]!)).toBe(true);
  });
});

describe("alert snooze", () => {
  const SNOOZE_MS = 15 * 60_000;

  test("snoozing a triggered alert re-arms it and holds evaluation for the window", () => {
    const now = 1_700_000_000_000;
    const alert = {
      ...createAlert("AAPL", "crosses", 180),
      status: "triggered" as const,
      triggeredAt: now - 60_000,
      lastCheckedPrice: 185,
      lastCheckedAt: now - 60_000,
      armedAt: 1,
    };

    const snoozed = snoozeAlert(alert, SNOOZE_MS, now);

    expect(snoozed.status).toBe("active");
    expect(snoozed.snoozedUntil).toBe(now + SNOOZE_MS);
    expect(snoozed.armedAt).toBe(now);
    expect(snoozed.triggeredAt).toBeUndefined();
    expect(snoozed.lastCheckedPrice).toBeUndefined();
    expect(isAlertSnoozed(snoozed, now)).toBe(true);
    expect(isAlertSnoozed(snoozed, now + SNOOZE_MS)).toBe(false);
    expect(evaluateAlert(snoozed, 175)).toBe(false);
  });

  test("snoozing an active alert keeps its state and only sets the window", () => {
    const now = 1_700_000_000_000;
    const alert = { ...createAlert("AAPL", "above", 200), lastCheckedPrice: 201, armedAt: 5 };

    const snoozed = snoozeAlert(alert, SNOOZE_MS, now);

    expect(snoozed.status).toBe("active");
    expect(snoozed.lastCheckedPrice).toBe(201);
    expect(snoozed.armedAt).toBe(5);
    expect(snoozed.snoozedUntil).toBe(now + SNOOZE_MS);
  });

  test("the poll gate skips a snoozed alert and re-arms silently once the window passes", () => {
    const now = 1_700_000_000_000;
    const alert = { ...createAlert("AAPL", "above", 200), snoozedUntil: now + 60_000 };

    expect(resolveAlertSnooze(alert, now)).toBe("snoozed");
    expect(alert.snoozedUntil).toBe(now + 60_000);
    // Still true, but the poll must not evaluate while the gate says snoozed.
    expect(evaluateAlert(alert, 201)).toBe(true);

    expect(resolveAlertSnooze(alert, now + 60_001)).toBe("rearmed");
    expect(alert.snoozedUntil).toBeUndefined();
    expect(resolveAlertSnooze(alert, now + 60_002)).toBe("active");
  });
});

describe("non-price alerts", () => {
  test("halted fires only for an active halt on that ticker", () => {
    const alert = createAlert("AAPL", "halted", 0);
    expect(formatAlertDescription(alert)).toBe("AAPL halted");
    expect(evaluateHaltedAlert(alert, new Set(["MSFT"]))).toBe(false);
    expect(evaluateHaltedAlert(alert, new Set(["AAPL"]))).toBe(true);
    expect(evaluateHaltedAlert(alert, new Set())).toBe(false);
    expect(evaluateAlert(alert, 1)).toBe(false);
  });

  test("short float compares the typed percent with the stored fraction", () => {
    const alert = createAlert("AAPL", "short_float", 5);
    expect(formatAlertDescription(alert)).toBe("AAPL SI ≥ 5%");
    // 0.0127 is 1.27%, not 1.27 and not already a percent.
    expect(evaluateShortFloatAlert(alert, 0.0127)).toBe(false);
    expect(evaluateShortFloatAlert(alert, 0.049)).toBe(false);
    expect(evaluateShortFloatAlert(alert, 0.05)).toBe(true);
    expect(0.05 >= alert.targetPrice).toBe(false);
    expect(evaluateShortFloatAlert(alert, null)).toBe(false);
    expect(evaluateShortFloatAlert(alert, undefined)).toBe(false);
    const tight = createAlert("AAPL", "short_float", 1.27);
    expect(evaluateShortFloatAlert(tight, 0.0127)).toBe(true);
  });

  test("ex-div fires when the next ex-date is within N days, including today, and not in the past", () => {
    const alert = createAlert("AAPL", "ex_div", 7);
    const now = new Date("2026-08-18T12:00:00.000Z");
    expect(formatAlertDescription(alert)).toBe("AAPL ex-div ≤ 7d");
    expect(evaluateExDivAlert(alert, new Date("2026-08-25T00:00:00.000Z"), now)).toBe(true);
    expect(evaluateExDivAlert(alert, parseExDividendDate("2026-08-25"), now)).toBe(true);
    expect(evaluateExDivAlert(alert, parseExDividendDate("2026-08-18"), now)).toBe(true);
    expect(evaluateExDivAlert(alert, new Date("2026-08-26T00:00:00.000Z"), now)).toBe(false);
    expect(evaluateExDivAlert(alert, new Date("2026-08-17T00:00:00.000Z"), now)).toBe(false);
    expect(evaluateExDivAlert(alert, null, now)).toBe(false);
    expect(evaluateExDivAlert(alert, parseExDividendDate("not-a-date"), now)).toBe(false);
  });

  test("day move fires for either direction at the threshold", () => {
    const alert = createAlert("AAPL", "pct_day", 5);
    expect(formatAlertDescription(alert)).toBe("AAPL day move ≥ 5%");
    expect(evaluatePctDayAlert(alert, -4.9)).toBe(false);
    expect(evaluatePctDayAlert(alert, -5)).toBe(true);
    expect(evaluatePctDayAlert(alert, 5)).toBe(true);
    expect(evaluatePctDayAlert(alert, undefined)).toBe(false);
    expect(evaluateAlert(alert, 999)).toBe(false);
  });
});
