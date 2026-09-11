import { describe, expect, test, beforeEach } from "bun:test";
import type { AlertEvaluationInput } from "../../../types/plugin";
import type { SecFilingItem } from "../../../types/data-provider";
import {
  SEC_8K_ALERT_CONDITION_ID,
  evaluateSec8KAlert,
  formatSec8KAlertDescription,
  is8KForm,
  resetSec8KAlertState,
  sec8KAlertsPlugin,
  type Sec8KListFn,
} from "./index";

function filing(
  accessionNumber: string,
  form: string,
  overrides: Partial<SecFilingItem> = {},
): SecFilingItem {
  return {
    accessionNumber,
    form,
    filingDate: new Date("2026-09-01T00:00:00Z"),
    cik: "0000320193",
    companyName: "Apple Inc.",
    ticker: "AAPL",
    filingUrl: `https://www.sec.gov/Archives/edgar/data/320193/${accessionNumber}-index.htm`,
    ...overrides,
  };
}

function alert(symbol: string, targetText?: string): AlertEvaluationInput {
  return { symbol, targetPrice: 0, ...(targetText !== undefined ? { targetText } : {}) };
}

function stubList(filings: SecFilingItem[]): Sec8KListFn & { calls: string[] } {
  const fn = (async (symbol: string) => {
    fn.calls.push(symbol);
    return filings;
  }) as Sec8KListFn & { calls: string[] };
  fn.calls = [];
  return fn;
}

const neverAborted = new AbortController().signal;

beforeEach(() => {
  resetSec8KAlertState();
});

describe("is8KForm", () => {
  test("matches 8-K and 8-K/A only", () => {
    expect(is8KForm("8-K")).toBe(true);
    expect(is8KForm("8-k/a")).toBe(true);
    expect(is8KForm("10-K")).toBe(false);
    expect(is8KForm("10-Q")).toBe(false);
    expect(is8KForm("8K")).toBe(false);
  });
});

describe("evaluateSec8KAlert", () => {
  test("baselines on first poll, stays quiet on repeat, fires on a new accession", async () => {
    const first = stubList([filing("0001", "8-K")]);
    expect(await evaluateSec8KAlert(alert("AAPL"), neverAborted, first)).toBe(false);
    expect(first.calls).toEqual(["AAPL"]);

    expect(await evaluateSec8KAlert(alert("AAPL"), neverAborted, first)).toBe(false);

    const second = stubList([
      filing("0002", "8-K", { filingDate: new Date("2026-09-02T00:00:00Z") }),
      filing("0001", "8-K"),
    ]);
    expect(await evaluateSec8KAlert(alert("AAPL"), neverAborted, second)).toBe(true);

    // Same latest again: no repeat trigger (dedupe).
    expect(await evaluateSec8KAlert(alert("AAPL"), neverAborted, second)).toBe(false);
  });

  test("ignores non-8-K forms", async () => {
    const list = stubList([
      filing("0009", "10-K", { filingDate: new Date("2026-09-03T00:00:00Z") }),
      filing("0008", "10-Q"),
    ]);
    expect(await evaluateSec8KAlert(alert("AAPL"), neverAborted, list)).toBe(false);
    // No 8-K seen, so nothing baselined: a later 8-K baselines instead of firing.
    expect(await evaluateSec8KAlert(alert("AAPL"), neverAborted, stubList([filing("0010", "8-K")]))).toBe(false);
  });

  test("treats 8-K/A as an 8-K filing", async () => {
    expect(await evaluateSec8KAlert(alert("AAPL"), neverAborted, stubList([filing("0001", "8-K/A")]))).toBe(false);
    expect(
      await evaluateSec8KAlert(
        alert("AAPL"),
        neverAborted,
        stubList([filing("0002", "8-K/A", { filingDate: new Date("2026-09-02T00:00:00Z") })]),
      ),
    ).toBe(true);
  });

  test("item filter only fires on matching 8-K items", async () => {
    const nonMatching = stubList([filing("0001", "8-K", { items: "1.01,7.01" })]);
    expect(await evaluateSec8KAlert(alert("AAPL", "2.02"), neverAborted, nonMatching)).toBe(false);

    const matching = stubList([filing("0001", "8-K", { items: "2.02,7.01" })]);
    // Baseline is per symbol (not per filter): 0001 was never recorded because
    // the filtered poll saw no match, so this baselines instead of firing.
    expect(await evaluateSec8KAlert(alert("AAPL", "2.02"), neverAborted, matching)).toBe(false);
    expect(
      await evaluateSec8KAlert(
        alert("AAPL", "2.02"),
        neverAborted,
        stubList([filing("0002", "8-K", {
          filingDate: new Date("2026-09-02T00:00:00Z"),
          items: "5.02",
        })]),
      ),
    ).toBe(false);
    expect(
      await evaluateSec8KAlert(
        alert("AAPL", "2.02"),
        neverAborted,
        stubList([filing("0003", "8-K", {
          filingDate: new Date("2026-09-03T00:00:00Z"),
          items: "2.02",
        })]),
      ),
    ).toBe(true);
  });

  test("symbol key is case-insensitive", async () => {
    expect(await evaluateSec8KAlert(alert("aapl"), neverAborted, stubList([filing("0001", "8-K")]))).toBe(false);
    expect(await evaluateSec8KAlert(alert("AAPL"), neverAborted, stubList([filing("0001", "8-K")]))).toBe(false);
  });

  test("tracks symbols independently", async () => {
    expect(await evaluateSec8KAlert(alert("AAPL"), neverAborted, stubList([filing("0001", "8-K")]))).toBe(false);
    expect(await evaluateSec8KAlert(alert("MSFT"), neverAborted, stubList([filing("0001", "8-K")]))).toBe(false);
    expect(
      await evaluateSec8KAlert(
        alert("MSFT"),
        neverAborted,
        stubList([filing("0002", "8-K", { filingDate: new Date("2026-09-02T00:00:00Z") })]),
      ),
    ).toBe(true);
    expect(await evaluateSec8KAlert(alert("AAPL"), neverAborted, stubList([filing("0001", "8-K")]))).toBe(false);
  });

  test("blank symbol never fetches", async () => {
    const list = stubList([filing("0001", "8-K")]);
    expect(await evaluateSec8KAlert(alert("   "), neverAborted, list)).toBe(false);
    expect(list.calls).toEqual([]);
  });

  test("aborted signal never fetches and never fires", async () => {
    const controller = new AbortController();
    controller.abort();
    const list = stubList([filing("0001", "8-K")]);
    expect(await evaluateSec8KAlert(alert("AAPL"), controller.signal, list)).toBe(false);
    expect(list.calls).toEqual([]);
  });

  test("picks the latest 8-K regardless of list order", async () => {
    const unordered = stubList([
      filing("0001", "8-K", { filingDate: new Date("2026-09-01T00:00:00Z") }),
      filing("0003", "8-K", { filingDate: new Date("2026-09-03T00:00:00Z") }),
      filing("0002", "8-K", { filingDate: new Date("2026-09-02T00:00:00Z") }),
    ]);
    expect(await evaluateSec8KAlert(alert("AAPL"), neverAborted, unordered)).toBe(false);
    // 0003 is recorded as latest; seeing only the older 0002 must neither
    // fire nor move the watermark backwards.
    expect(
      await evaluateSec8KAlert(alert("AAPL"), neverAborted, stubList([filing("0002", "8-K")])),
    ).toBe(false);
    expect(
      await evaluateSec8KAlert(
        alert("AAPL"),
        neverAborted,
        stubList([filing("0004", "8-K", { filingDate: new Date("2026-09-04T00:00:00Z") })]),
      ),
    ).toBe(true);
  });
});

describe("formatSec8KAlertDescription", () => {
  test("names the symbol and optional item filter", () => {
    expect(formatSec8KAlertDescription(alert("aapl"))).toBe("AAPL 8-K filed");
    expect(formatSec8KAlertDescription(alert("AAPL", "2.02"))).toBe("AAPL 8-K filed (item 2.02)");
  });
});

describe("sec8KAlertsPlugin", () => {
  test("is headless and toggleable", () => {
    expect(sec8KAlertsPlugin.id).toBe("sec-8k-alerts");
    expect(sec8KAlertsPlugin.toggleable).toBe(true);
    expect(sec8KAlertsPlugin.panes).toBeUndefined();
    expect(sec8KAlertsPlugin.paneTemplates).toBeUndefined();
  });

  test("setup registers the alert condition; dispose cleans up", () => {
    const registered: Parameters<Parameters<typeof sec8KAlertsPlugin.setup>[0]["registerAlertCondition"]>[0][] = [];
    const ctx = {
      registerAlertCondition: (condition: (typeof registered)[number]) => {
        registered.push(condition);
      },
    } as unknown as Parameters<NonNullable<typeof sec8KAlertsPlugin.setup>>[0];

    sec8KAlertsPlugin.setup?.(ctx);
    try {
      expect(registered).toHaveLength(1);
      expect(registered[0]?.id).toBe(SEC_8K_ALERT_CONDITION_ID);
      expect(registered[0]?.label).toBe("8-K filed");
      expect(registered[0]?.targetType).toBe("text");
      expect(typeof registered[0]?.evaluate).toBe("function");
      expect(registered[0]?.formatDescription?.(alert("AAPL"))).toBe("AAPL 8-K filed");
    } finally {
      sec8KAlertsPlugin.dispose?.();
    }
  });
});
