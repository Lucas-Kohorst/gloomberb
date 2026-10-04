import { expect, spyOn, test } from "bun:test";
import { SecEdgarClient } from "../../../sources/sec-edgar";
import { createTestDataProvider } from "../../../test-support/data-provider";
import { loadSecFilings } from "./client";

test("form filter queries EDGAR and an unfiltered load does not send it", async () => {
  const edgar = spyOn(SecEdgarClient.prototype, "getRecentFilings").mockResolvedValue([]);
  let providerCalls = 0;
  const provider = createTestDataProvider({
    getSecFilings: async () => {
      providerCalls += 1;
      return [];
    },
  });

  try {
    await loadSecFilings(provider, "SPY", 10, "", undefined, { forms: ["n-1a", "485BPOS"] });
    expect(providerCalls).toBe(0);
    expect(edgar).toHaveBeenCalledWith("SPY", 10, { forms: ["N-1A", "485BPOS"] });

    await loadSecFilings(provider, "AAPL", 10);
    await loadSecFilings(provider, "AAPL", 10, "", undefined, { forms: ["  "] });
    expect(providerCalls).toBe(2);
    expect(edgar).toHaveBeenCalledTimes(1);
  } finally {
    edgar.mockRestore();
  }
});
