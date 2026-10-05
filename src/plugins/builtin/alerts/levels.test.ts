import { expect, test } from "bun:test";
import { activePriceAlertsFor, addLevelAlert, levelAlertCondition } from "./levels";

test("a level above the quote becomes an above alert and a duplicate is not written twice", () => {
  const first = addLevelAlert(null, { symbol: "nvda", exchange: "NASDAQ" }, 230, 200);
  expect("error" in first).toBe(false);
  if ("error" in first) return;
  expect(first.created).toBe(true);
  expect(first.alert.symbol).toBe("NVDA");
  expect(first.alert.condition).toBe("above");
  expect(first.alert.targetPrice).toBe(230);
  expect(first.alert.exchange).toBe("NASDAQ");

  const second = addLevelAlert(first.json, { symbol: "NVDA", exchange: "NMS" }, 230, 200);
  expect("error" in second).toBe(false);
  if ("error" in second) return;
  expect(second.created).toBe(false);
  expect(second.json).toBe(first.json);
  expect(activePriceAlertsFor(first.json, { symbol: "NVDA", exchange: "NASDAQ" }).map((alert) => alert.targetPrice)).toEqual([230]);
  expect(activePriceAlertsFor(first.json, { symbol: "AMD", exchange: "NASDAQ" })).toEqual([]);
});

test("direction follows the quote, and a store that does not parse is left alone", () => {
  expect(levelAlertCondition(90, 100)).toBe("below");
  expect(levelAlertCondition(100, 100)).toBe("crosses");
  expect(levelAlertCondition(100, null)).toBe("crosses");
  const broken = addLevelAlert("{", { symbol: "AAPL" }, 1, 1);
  expect("error" in broken).toBe(true);
});
