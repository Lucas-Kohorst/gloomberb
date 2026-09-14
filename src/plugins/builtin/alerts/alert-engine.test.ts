import { describe, expect, test } from "bun:test";
import {
  createAlert,
  deserializeAlerts,
  editAlert,
  evaluateAlert,
  evaluateExDivAlert,
  evaluateHaltedAlert,
  evaluateShortFloatAlert,
  isAlertSnoozed,
  rearmAlert,
  resolveAlertSnooze,
  serializeAlerts,
  snoozeAlert,
} from "./alert-engine";
import {
  parseAlertCommandValues,
  parseAlertShortcutValues,
  parseWeatherAlertCommandValues,
} from "./command";
import {
  evaluateNewsMentionAlert,
  evaluatePctDayAlert,
  evaluateVolumeSpikeAlert,
} from "./condition-evaluators";

function article(id: string, publishedAt: string, title: string) {
  return {
    id,
    title,
    summary: "",
    publishedAt: new Date(publishedAt),
  } as any;
}

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
      lastQuoteProviderId: "yahoo",
    };

    const edited = editAlert(alert, "aapl", "crosses", 180);

    expect(edited).toEqual({
      id: alert.id,
      symbol: "AAPL",
      exchange: "NASDAQ",
      condition: "crosses",
      targetPrice: 180,
      createdAt: alert.createdAt,
      status: "active",
      message: "watch this",
    });
    // A stale lastCheckedPrice would make `crosses` fire off the previous symbol's baseline.
    expect(evaluateAlert(edited, 185)).toBe(false);
  });

  test("rearming a crosses alert drops the old quote baseline", () => {
    const alert = {
      ...createAlert("AAPL", "crosses", 180),
      status: "triggered" as const,
      triggeredAt: 123,
      lastCheckedPrice: 185,
    };

    const rearmed = rearmAlert(alert);

    expect(rearmed.status).toBe("active");
    expect(rearmed.lastCheckedPrice).toBeUndefined();
    expect(evaluateAlert(rearmed, 175)).toBe(false);
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
    // A missing field means not snoozed, so the alert evaluates immediately.
    expect(isAlertSnoozed(alerts[0]!)).toBe(false);

    // Once set, the field survives the store roundtrip.
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
    };

    const snoozed = snoozeAlert(alert, SNOOZE_MS, now);

    expect(snoozed.status).toBe("active");
    expect(snoozed.snoozedUntil).toBe(now + SNOOZE_MS);
    // Re-armed like a manual re-arm: the trigger and quote lifecycle drop so
    // `crosses` starts from a fresh baseline.
    expect(snoozed.triggeredAt).toBeUndefined();
    expect(snoozed.lastCheckedPrice).toBeUndefined();
    expect(isAlertSnoozed(snoozed, now)).toBe(true);
    expect(isAlertSnoozed(snoozed, now + SNOOZE_MS)).toBe(false);
  });

  test("snoozing an active alert keeps its state and only sets the window", () => {
    const now = 1_700_000_000_000;
    const alert = { ...createAlert("AAPL", "above", 200), lastCheckedPrice: 201 };

    const snoozed = snoozeAlert(alert, SNOOZE_MS, now);

    expect(snoozed.status).toBe("active");
    expect(snoozed.lastCheckedPrice).toBe(201);
    expect(snoozed.snoozedUntil).toBe(now + SNOOZE_MS);
  });

  test("snoozing keeps condition-defining fields that a plain edit would drop", () => {
    const alert = {
      ...createAlert("LAX", "weather", 0),
      message: "LAX high final",
      targetText: "Reuters",
      weather: {
        stationId: "LAX",
        condition: { kind: "stale-source", sourceId: "twc-kalshi", maxAgeMs: 900_000 },
      },
      status: "triggered" as const,
      triggeredAt: 123,
    };

    const snoozed = snoozeAlert(alert, SNOOZE_MS, 1);

    expect(snoozed.weather).toEqual(alert.weather);
    expect(snoozed.targetText).toBe("Reuters");
    expect(snoozed.message).toBe("LAX high final");
  });

  test("the poll gate skips a snoozed alert and re-arms silently once the window passes", () => {
    const now = 1_700_000_000_000;
    const alert = { ...createAlert("AAPL", "above", 200), snoozedUntil: now + 60_000 };

    expect(resolveAlertSnooze(alert, now)).toBe("snoozed");
    // The window is untouched while it still holds.
    expect(alert.snoozedUntil).toBe(now + 60_000);

    expect(resolveAlertSnooze(alert, now + 60_001)).toBe("rearmed");
    // Silent re-arm: the stale field is cleared so the alert evaluates as active.
    expect(alert.snoozedUntil).toBeUndefined();

    expect(resolveAlertSnooze(alert, now + 60_002)).toBe("active");
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

describe("additional alert conditions", () => {
  test("day move fires for either direction at the threshold", () => {
    const alert = createAlert("AAPL", "pct_day", 5);
    expect(evaluatePctDayAlert(alert, -4.9)).toBe(false);
    expect(evaluatePctDayAlert(alert, -5)).toBe(true);
    expect(evaluatePctDayAlert(alert, 5)).toBe(true);
  });

  test("volume spike requires a usable average volume", () => {
    const alert = createAlert("AAPL", "volume_spike", 3);
    expect(evaluateVolumeSpikeAlert(alert, 2_999, 1_000)).toBe(false);
    expect(evaluateVolumeSpikeAlert(alert, 3_000, 1_000)).toBe(true);
    expect(evaluateVolumeSpikeAlert(alert, 3_000, undefined)).toBe(false);
    expect(evaluateVolumeSpikeAlert(alert, 3_000, 0)).toBe(false);
  });

  test("news mentions baseline and only fire for newer matching articles", () => {
    const alert = createAlert("AAPL", "news_mention", 0);
    alert.targetText = "merger";
    const first = evaluateNewsMentionAlert(alert, [article("old", "2026-08-18T10:00:00Z", "Merger rumors")]);
    expect(first.triggered).toBe(false);
    Object.assign(alert, first);

    expect(evaluateNewsMentionAlert(alert, [article("old", "2026-08-18T10:00:00Z", "Merger rumors")]).triggered).toBe(false);
    const second = evaluateNewsMentionAlert(alert, [
      article("old", "2026-08-18T10:00:00Z", "Merger rumors"),
      article("new", "2026-08-18T11:00:00Z", "Merger announced"),
    ]);
    expect(second.triggered).toBe(true);
  });
});

describe("alert command parser", () => {
  test("parses non-price and threshold shortcuts", () => {
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
    expect(parseAlertCommandValues(parseAlertShortcutValues("AAPL day 5"))).toEqual({
      symbol: "AAPL",
      condition: "pct_day",
      price: 5,
    });
    expect(parseAlertCommandValues(parseAlertShortcutValues("AAPL news merger"))).toEqual({
      symbol: "AAPL",
      condition: "news_mention",
      price: 0,
      targetText: "merger",
    });
  });

  test("parses weather conditions with only supported source metrics", () => {
    expect(parseWeatherAlertCommandValues({
      station: "lax", condition: "above", metric: "high", target: "85",
    })).toEqual({
      stationId: "LAX", condition: "observed-threshold-crossing", metric: "high", target: 85,
    });
    expect(parseWeatherAlertCommandValues({
      station: "lax", condition: "stale", metric: "high", target: "15",
    })).toEqual({
      stationId: "LAX", condition: "stale-source", target: 15,
    });
    expect(parseWeatherAlertCommandValues({
      station: "lax", condition: "discrepancy", metric: "hourly", target: "2",
    })).toBeNull();
  });
});
