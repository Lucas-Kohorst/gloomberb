import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "../../../renderers/opentui/test-utils";
import { SeriesEditorDialog } from "./editor";
import {
  appendChartSeries,
  buildFundamentalChartPreset,
  buildPriceChartPreset,
  parseSeriesExpression,
} from "./presets";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

async function emitKey(
  name: string,
  sequence: string,
  overrides: Partial<{ shift: boolean }> = {},
) {
  await act(async () => {
    (testSetup!.renderer as any).keyInput.emit("keypress", {
      name,
      sequence,
      ctrl: false,
      meta: false,
      super: false,
      option: false,
      shift: overrides.shift ?? false,
      eventType: "press",
      repeated: false,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.propagationStopped = true;
      },
    });
    await testSetup!.renderOnce();
  });
}

async function waitForFrameToContain(text: string, attempts = 12): Promise<string> {
  let frame = "";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await act(async () => {
      await Bun.sleep(10);
      await testSetup!.renderOnce();
    });
    frame = testSetup!.captureCharFrame();
    if (frame.includes(text)) return frame;
  }
  return frame;
}

afterEach(async () => {
  if (!testSetup) return;
  await act(async () => {
    testSetup!.renderer.destroy();
  });
  testSetup = undefined;
});

describe("chart composer series editor", () => {
  test("focuses its catalog quick-add outside the app-state root", async () => {
    testSetup = await testRender(
      <SeriesEditorDialog
        dialogId="series-editor-test"
        initialSpec={buildPriceChartPreset("AAPL")}
        dismiss={() => {}}
        resolve={() => {}}
      />,
      { width: 92, height: 42 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
    });
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Add a series");
    expect(frame).toContain("AAPL:market.ohlcv");

    await act(async () => {
      await testSetup!.mockInput.typeText("MSFT revenue");
      await testSetup!.renderOnce();
    });

    expect(await waitForFrameToContain("MSFT — Revenue")).toContain("MSFT — Revenue");

    await emitKey("enter", "\r");
    await emitKey("a", "a");
    await act(async () => {
      await Bun.sleep(80);
      await testSetup!.mockInput.typeText("AAPL free cash flow");
      await testSetup!.renderOnce();
    });

    const secondAddFrame = await waitForFrameToContain("AAPL — Free Cash Flow");
    expect(secondAddFrame).toContain("AAPL free cash flow");
    expect(secondAddFrame).toContain("AAPL — Free Cash Flow");
    expect(secondAddFrame).not.toContain("MSFT revenueAAPL");
  });

  test("adds an idea expression as a study with its source series", async () => {
    let resolved: ReturnType<typeof buildPriceChartPreset> | null | undefined;
    testSetup = await testRender(
      <SeriesEditorDialog
        dialogId="series-editor-idea-test"
        initialSpec={buildPriceChartPreset("AAPL")}
        dismiss={() => {}}
        resolve={(next) => {
          resolved = next;
        }}
      />,
      { width: 92, height: 42 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
    });
    await act(async () => {
      await testSetup!.mockInput.typeText("MSFT drawdown");
      await testSetup!.renderOnce();
    });
    expect(await waitForFrameToContain("MSFT — Drawdown")).toContain("MSFT — Drawdown");

    await emitKey("enter", "\r");
    await emitKey("a", "a");
    await act(async () => {
      await Bun.sleep(80);
      await testSetup!.renderOnce();
    });

    // Idea rows merge through applyChartIdeaToSpec, so the source is appended
    // and the drawdown study lands in its own lower panel.
    const rows = testSetup.captureCharFrame().split("\n");
    const actionRow = rows.findIndex((line) => line.includes("Remove") && line.includes("Save"));
    const saveColumn = rows[actionRow]?.indexOf("Save") ?? -1;
    expect(actionRow).toBeGreaterThan(0);
    expect(saveColumn).toBeGreaterThan(0);
    await act(async () => {
      await testSetup!.mockMouse.click(saveColumn + 1, actionRow);
      await testSetup!.renderOnce();
    });

    expect(resolved?.series.map((series) => series.source)).toMatchObject([
      { kind: "security", instrument: { symbol: "AAPL" } },
      { kind: "security", instrument: { symbol: "MSFT" } },
    ]);
    expect(resolved?.studies.find((study) => study.kind === "drawdown")).toMatchObject({
      kind: "drawdown",
      panelId: "drawdown",
      inputSeriesIds: ["msft-market-ohlcv-1"],
    });
  });

  test("keeps the final series when removal is requested", async () => {
    let resolved = undefined as ReturnType<typeof buildPriceChartPreset> | null | undefined;
    testSetup = await testRender(
      <SeriesEditorDialog
        dialogId="series-editor-last-series-test"
        initialSpec={buildPriceChartPreset("AAPL")}
        dismiss={() => {}}
        resolve={(next) => {
          resolved = next;
        }}
      />,
      { width: 92, height: 42 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
    });
    const frame = testSetup.captureCharFrame();
    const rows = frame.split("\n");
    const actionRow = rows.findIndex((line) => line.includes("Remove") && line.includes("Save"));
    expect(actionRow).toBeGreaterThan(0);
    const removeColumn = rows[actionRow]!.indexOf("Remove");
    const saveColumn = rows[actionRow]!.indexOf("Save");
    expect(removeColumn).toBeGreaterThan(0);
    expect(saveColumn).toBeGreaterThan(removeColumn);

    await act(async () => {
      await testSetup!.mockMouse.click(removeColumn, actionRow);
      await testSetup!.mockMouse.click(saveColumn, actionRow);
      await testSetup!.renderOnce();
    });

    expect(resolved?.series).toHaveLength(1);
    expect(resolved?.series[0]?.source).toMatchObject({
      kind: "security",
      instrument: { symbol: "AAPL" },
    });
  });

  test("edits financial timing independently from style", async () => {
    let resolved: ReturnType<typeof buildFundamentalChartPreset> | null | undefined;
    testSetup = await testRender(
      <SeriesEditorDialog
        dialogId="series-editor-timing-test"
        initialSpec={buildFundamentalChartPreset(["AAPL"])}
        dismiss={() => {}}
        resolve={(next) => {
          resolved = next;
        }}
      />,
      { width: 92, height: 48 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
    });
    const rows = testSetup.captureCharFrame().split("\n");
    const timingLabelRow = rows.findIndex((line) => line.includes("Timing"));
    const timingRow = timingLabelRow + 1;
    const availableColumn = rows[timingRow]?.indexOf("Available Date") ?? -1;
    const styleLabelRow = rows.findIndex((line) => line.trim() === "Style");
    const styleRow = styleLabelRow + 1;
    const lineColumn = rows[styleRow]?.indexOf("Line") ?? -1;
    const actionRow = rows.findIndex((line) => line.includes("Remove") && line.includes("Save"));
    const saveColumn = rows[actionRow]?.indexOf("Save") ?? -1;
    expect(timingLabelRow).toBeGreaterThan(0);
    expect(availableColumn).toBeGreaterThan(0);
    expect(styleLabelRow).toBeGreaterThan(0);
    expect(lineColumn).toBeGreaterThan(0);
    expect(saveColumn).toBeGreaterThan(0);

    await act(async () => {
      await testSetup!.mockMouse.click(availableColumn + 1, timingRow);
      await testSetup!.renderOnce();
    });
    await act(async () => {
      await testSetup!.mockMouse.click(lineColumn + 1, styleRow);
      await testSetup!.renderOnce();
    });
    await act(async () => {
      await testSetup!.mockMouse.click(saveColumn + 1, actionRow);
      await testSetup!.renderOnce();
    });

    expect(resolved?.series[0]).toMatchObject({
      style: "line",
      source: { kind: "security", timestampMode: "available-at" },
    });
  });

  test("dismisses the editor from the initially focused quick-add with Escape", async () => {
    let resolved: ReturnType<typeof buildPriceChartPreset> | null | undefined;
    testSetup = await testRender(
      <SeriesEditorDialog
        dialogId="series-editor-escape-test"
        initialSpec={buildPriceChartPreset("AAPL")}
        dismiss={() => {}}
        resolve={(next) => {
          resolved = next;
        }}
      />,
      { width: 92, height: 42 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
    });
    await emitKey("escape", "\u001b");
    expect(resolved).toBeNull();
  });

  test("tabs through add, series, and exact source without clearing the add query", async () => {
    const initialSpec = appendChartSeries(
      buildPriceChartPreset("AAPL"),
      parseSeriesExpression("MSFT")!,
    ).spec;
    testSetup = await testRender(
      <SeriesEditorDialog
        dialogId="series-editor-focus-order-test"
        initialSpec={initialSpec}
        dismiss={() => {}}
        resolve={() => {}}
      />,
      { width: 92, height: 42 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.mockInput.typeText("revenue");
      await testSetup!.renderOnce();
    });
    expect(testSetup.captureCharFrame()).toContain("› Add a series");

    await emitKey("tab", "\t");
    await emitKey("down", "\u001b[B");
    await emitKey("tab", "\t");
    let frame = await waitForFrameToContain("› Exact source (advanced)");
    expect(frame).toContain("revenue");
    expect(frame).toContain("› Exact source (advanced)");
    expect(frame).toContain("MSFT:market.ohlcv");

    await emitKey("tab", "\t", { shift: true });
    await emitKey("tab", "\t", { shift: true });
    await act(async () => {
      await testSetup!.mockInput.typeText("x");
      await testSetup!.renderOnce();
    });
    frame = testSetup.captureCharFrame();
    expect(frame).toContain("› Add a series");
    expect(frame).toContain("revenuex");
  });

  test("contains editor fields within a narrow terminal", async () => {
    testSetup = await testRender(
      <SeriesEditorDialog
        dialogId="series-editor-narrow-test"
        initialSpec={buildPriceChartPreset("AAPL")}
        dismiss={() => {}}
        resolve={() => {}}
      />,
      { width: 60, height: 42 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
    });

    const contentWidth = 60 - 8;
    const overflowRows = testSetup.captureCharFrame()
      .split("\n")
      .map((row) => row.trimEnd())
      .filter((row) => row.length > contentWidth);
    expect(overflowRows).toEqual([]);
  });

  test("edits every segmented series setting with Tab and arrow keys", async () => {
    let resolved: ReturnType<typeof buildFundamentalChartPreset> | null | undefined;
    testSetup = await testRender(
      <SeriesEditorDialog
        dialogId="series-editor-keyboard-settings-test"
        initialSpec={buildFundamentalChartPreset(["AAPL"])}
        dismiss={() => {}}
        resolve={(next) => {
          resolved = next;
        }}
      />,
      { width: 92, height: 48 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
    });

    await emitKey("tab", "\t");
    await emitKey("tab", "\t");
    await emitKey("tab", "\t");

    await emitKey("right", "\u001b[C");
    await emitKey("tab", "\t");
    await emitKey("right", "\u001b[C");
    await emitKey("tab", "\t");
    await emitKey("right", "\u001b[C");
    await emitKey("tab", "\t");
    await emitKey("right", "\u001b[C");
    await emitKey("tab", "\t");
    await emitKey("right", "\u001b[C");
    await emitKey("tab", "\t");
    await emitKey("right", "\u001b[C");
    await emitKey("tab", "\t");
    await emitKey("right", "\u001b[C");
    await emitKey("tab", "\t");
    await emitKey("right", "\u001b[C");
    await emitKey("enter", "\r");

    expect(resolved?.series[0]).toMatchObject({
      style: "line",
      transform: "percent",
      axis: "right",
      panelId: "main",
      source: {
        kind: "security",
        period: "annual",
        timestampMode: "available-at",
      },
    });
    expect(resolved?.series[0]?.visible).not.toBe(false);
    expect(resolved?.panels.find((panel) => panel.id === "main")?.scale).toBe("log");
  });
});
