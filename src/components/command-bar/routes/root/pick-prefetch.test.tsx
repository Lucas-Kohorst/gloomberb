import { afterEach, describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { createOpenTuiTestHarness } from "../../../../renderers/opentui/test-utils";
import type { InstrumentRef } from "../../../../market-data/request-types";
import type { ResultItem } from "../../list/model";
import { useRootPickPrefetch } from "./pick-prefetch";

const tui = createOpenTuiTestHarness();
let prefetched: string[] = [];
const prefetch = (instrument: InstrumentRef) => {
  prefetched.push(`${instrument.symbol}:${instrument.exchange}`);
};

function row(symbol: string, exchange: string): ResultItem {
  return {
    id: `${symbol}:${exchange}`,
    label: symbol,
    detail: "",
    category: "Exact Match",
    kind: "search",
    prefetchInstrument: { symbol, exchange, instrument: null },
    action: () => {},
  };
}

let setPick: (pick: ResultItem) => void = () => {};

function Harness({ initial }: { initial: ResultItem }) {
  const [pick, set] = useState(initial);
  setPick = set;
  useRootPickPrefetch(pick, prefetch);
  return <text>{pick.label}</text>;
}

const wait = (ms: number) => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, ms));
});

afterEach(() => {
  prefetched = [];
});

describe("useRootPickPrefetch", () => {
  test("warms only the pick that rests, once per instrument", async () => {
    await tui.render(<Harness initial={row("N", "NASDAQ")} />, { width: 10, height: 1 });
    // Typing on: each pick lasts less than the rest window.
    for (const pick of [row("NV", "SET"), row("NVD", "XETRA"), row("NVDA", "NASDAQ")]) {
      await act(async () => { setPick(pick); });
      await wait(50);
    }
    expect(prefetched).toEqual([]);

    await wait(250);
    expect(prefetched).toEqual(["NVDA:NASDAQ"]);

    // Away and back to the same listing does not ask again.
    await act(async () => { setPick(row("NV", "SET")); });
    await wait(250);
    await act(async () => { setPick(row("NVDA", "NASDAQ")); });
    await wait(250);
    expect(prefetched).toEqual(["NVDA:NASDAQ", "NV:SET"]);
  });
});
