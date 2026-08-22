import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "../../renderers/opentui/test-utils";
import {
  ChartHarness,
  CpiDataTabHarness,
  GroupedDetailHarness,
  cleanupPredictionTest,
  flushFrames,
} from "./test-helpers";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(async () => {
  await cleanupPredictionTest(testSetup);
  testSetup = undefined;
});

describe("prediction markets detail views", () => {
  test("renders chart history even when cached dates are plain strings", async () => {
    testSetup = await testRender(
      <ChartHarness
        history={[
          { date: "2026-04-01T00:00:00Z", close: 0.45 },
          { date: "2026-04-02T00:00:00Z", close: 0.48 },
        ]}
      />,
      { width: 80, height: 12 },
    );
    await flushFrames(testSetup);

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("1M");
    expect(frame).not.toContain("TypeError");
  });

  test("renders grouped selections as ranked outcomes in the detail overview", async () => {
    testSetup = await testRender(<GroupedDetailHarness />, {
      width: 64,
      height: 24,
    });
    await flushFrames(testSetup);

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Outcomes");
    expect(frame).toContain("Above 4.25%");
    expect(frame).toContain("Above 4.50%");
    expect(frame).not.toContain("Ranked by implied YES probability.");
    expect(frame).not.toContain("TOP Above 4.25%");
    expect(frame).not.toContain("Kalshi");
    expect(frame).not.toContain("targets");
  });

  test("keeps grouped outcomes in place while selected detail is loading", async () => {
    testSetup = await testRender(<GroupedDetailHarness loading />, {
      width: 64,
      height: 24,
    });
    await flushFrames(testSetup);

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Outcomes");
    expect(frame).toContain("Above 4.25%");
    expect(frame).not.toContain("Loading market detail...");
  });

  test("moves price history onto its own chart tab", async () => {
    testSetup = await testRender(<GroupedDetailHarness />, {
      width: 64,
      height: 24,
    });
    await flushFrames(testSetup);
    expect(testSetup.captureCharFrame()).not.toContain("No chart history.");

    await cleanupPredictionTest(testSetup);
    testSetup = await testRender(<GroupedDetailHarness detailTab="chart" />, {
      width: 64,
      height: 24,
    });
    await flushFrames(testSetup);
    expect(testSetup.captureCharFrame()).toContain("No chart history.");
  });

  test("shows the chart tab as loading instead of empty while detail loads", async () => {
    testSetup = await testRender(
      <GroupedDetailHarness detailTab="chart" loading />,
      { width: 64, height: 24 },
    );
    await flushFrames(testSetup);

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Loading chart...");
    expect(frame).not.toContain("No chart history.");
  });

  test("shows no matching settlement series when a market has no known source", async () => {
    testSetup = await testRender(
      <GroupedDetailHarness detailTab="data" />,
      { width: 64, height: 24 },
    );
    await flushFrames(testSetup);

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("No matching settlement series.");
  });

  test("shows settlement source and suggested data feeds on the data tab", async () => {
    testSetup = await testRender(<CpiDataTabHarness width={64} />, {
      width: 64,
      height: 24,
    });
    await flushFrames(testSetup);

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Settles to:");
    expect(frame).toContain("Suggested data feeds");
    expect(frame).toContain("FRED");
    expect(frame).toContain("CPIAUCSL");
    expect(frame).toContain("SRC");
    expect(frame).toContain("SERIES");
    expect(frame).toContain("G");
  });

});
