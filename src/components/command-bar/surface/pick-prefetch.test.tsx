import { afterEach, expect, test } from "bun:test";
import { createOpenTuiTestHarness } from "../../../renderers/opentui/test-utils";
import { MarketDataCoordinator, setSharedMarketDataCoordinator } from "../../../market-data/coordinator";
import { createTestDataProvider } from "../../../test-support/data-provider";
import { createTestTicker } from "../../../test-support/ticker";
import type { InstrumentSearchResult } from "../../../types/instrument";
import { instrumentIdentityKey } from "../../../utils/instrument-identity";
import { CommandBarHarness, createCommandBarTestControls } from "./test-harness";

const tui = createOpenTuiTestHarness();
const { waitForFrameToContain } = createCommandBarTestControls(() => tui.setup());
const wait = async (ms: number) => {
  await Bun.sleep(ms);
  await tui.setup().renderOnce();
};

afterEach(() => setSharedMarketDataCoordinator(null));

test("the pick is warmed once the search for the typed query has answered, not the saved row shown while it is out", async () => {
  const warmed: string[] = [];
  const coordinator = new MarketDataCoordinator(createTestDataProvider());
  coordinator.warmTickerGaps = (instrument) => { if (instrument) warmed.push(instrumentIdentityKey(instrument)); };
  setSharedMarketDataCoordinator(coordinator);
  const answer = Promise.withResolvers<InstrumentSearchResult[]>();
  await tui.render(<CommandBarHarness
    query="DES NVT"
    live
    extraTickers={[createTestTicker("NVTS", "Navitas Semiconductor")]}
    dataProvider={createTestDataProvider({ search: () => answer.promise })}
  />, { width: 100, height: 24 });
  await waitForFrameToContain("NVTS");
  // Well past the rest window with the search still out: the saved row is not what Enter will land on.
  await wait(600);
  expect(warmed).toEqual([]);

  answer.resolve([{ providerId: "test", symbol: "NVT", name: "nVent Electric PLC", exchange: "NYSE", currency: "USD", type: "EQUITY" }]);
  await waitForFrameToContain("nVent Electric PLC");
  await wait(400);
  expect(warmed).toEqual(["NVT|NYSE|||"]);
});
