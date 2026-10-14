import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { createOpenTuiTestHarness } from "../../renderers/opentui/test-utils";
import { AppContext, createInitialState } from "../../state/app/context";
import { createStaticAppStore } from "../../test-support/app-store";
import { createDefaultConfig } from "../../types/config";
import { MarketBoardStack, type MarketBoardRow } from "./index";

const tui = createOpenTuiTestHarness();
const store = createStaticAppStore(createInitialState(createDefaultConfig(join(homedir(), ".cache/gloom-smoke/glo-750/market-board-test"))));

function row(id: string, status: MarketBoardRow["status"]): MarketBoardRow {
  return {
    id, label: id, value: 4.1, valueText: "4.10", change: 0.1, changeText: "+0.10", percentile: 50, asOf: "2026-10-09", history: [], status,
  };
}

async function board(width: number, rows: MarketBoardRow[]) {
  await tui.render(
    <AppContext value={store}>
      <MarketBoardStack rows={rows} width={width} height={8} focused selectedId={null} onSelectedIdChange={() => {}}
        openId={null} onOpenIdChange={() => {}} renderDetail={() => null} />
    </AppContext>,
    { width, height: 8 },
  );
  await tui.renderFrames(2);
  return tui.frame();
}

describe("MarketBoardStack", () => {
  // A stale row carries the word beside its date, in a column made wide enough
  // for both, so a narrow board never cuts the date to fit the word.
  test("a stale row reads its whole date and the word at wide and narrow widths", async () => {
    for (const width of [100, 64, 56]) {
      const frame = await board(width, [row("DGS2", "stale"), row("DGS10", "available")]);
      expect(frame).toMatch(/(2026-)?10-09 stale/);
      expect(frame).not.toContain("…");
    }
    const fresh = await board(100, [row("DGS2", "available")]);
    expect(fresh).toContain("2026-10-09");
    expect(fresh).not.toContain("stale");
  });
});
