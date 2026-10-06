import { expect, test } from "bun:test";
import { pollFooterSegment, pollIntervalMenuOptions, updatedFooterInfo } from "./freshness-footer";

const NOW = Date.UTC(2026, 9, 6, 15, 0, 0);

test("the age sits on the left as updated ~0m and the poll chip lists the intervals", () => {
  expect(updatedFooterInfo(null)).toEqual([]);
  expect(updatedFooterInfo(NOW, NOW)[0]?.parts[0]?.text).toBe("updated ~0m");
  expect(updatedFooterInfo(NOW - 5 * 60_000, NOW)[0]?.parts[0]?.text).toBe("updated ~5m");
  expect(updatedFooterInfo(NOW - 30_000, NOW)[0]?.parts[0]?.text).toBe("updated ~0m");

  const selected: string[] = [];
  const poll = pollFooterSegment(30, (minutes) => selected.push(String(minutes)));
  expect(poll.parts[0]?.text).toBe("poll 30m");
  expect(poll.menu?.options).toEqual(pollIntervalMenuOptions());
  expect(poll.menu?.options.map((option) => option.label)).toEqual([
    "1 minute",
    "5 minutes",
    "15 minutes",
    "30 minutes",
  ]);
  poll.menu?.onSelect("5");
  expect(selected).toEqual(["5"]);
  expect(pollFooterSegment(1).menu).toBeUndefined();
});
