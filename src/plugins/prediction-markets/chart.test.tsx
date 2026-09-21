import { afterEach, describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { createOpenTuiTestRoot as createRoot } from "../../renderers/opentui/test-utils";
import { act, useReducer } from "react";
import {
  AppContext,
  PaneInstanceProvider,
  appReducer,
  createInitialState,
} from "../../state/app/context";
import { createDefaultConfig } from "../../types/config";
import { getNativeSurfaceManager } from "../../components/chart/native/surface/manager";
import { PredictionMarketChart } from "./chart";

const TEST_PANE_ID = "prediction-chart:test";

let testSetup: Awaited<ReturnType<typeof createTestRenderer>> | undefined;
let root: ReturnType<typeof createRoot> | undefined;
const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

function ChartHarness() {
  const [state, dispatch] = useReducer(
    appReducer,
    (() => {
      const config = createDefaultConfig("/tmp/gloomberb-test");
      const initial = createInitialState(config);
      initial.focusedPaneId = TEST_PANE_ID;
      return initial;
    })(),
  );

  return (
    <AppContext value={{ state, dispatch }}>
      <PaneInstanceProvider paneId={TEST_PANE_ID}>
        <PredictionMarketChart
          history={[
            { date: new Date("2026-04-01T00:00:00Z"), close: 0.45 },
            { date: new Date("2026-04-02T00:00:00Z"), close: 0.48 },
            { date: new Date("2026-04-03T00:00:00Z"), close: 0.51 },
            { date: new Date("2026-04-04T00:00:00Z"), close: 0.49 },
          ]}
          width={60}
          height={12}
          range="1M"
          onRangeSelect={() => {}}
        />
      </PaneInstanceProvider>
    </AppContext>
  );
}

async function flushFrames(count = 4) {
  for (let index = 0; index < count; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
      await testSetup!.renderOnce();
    });
  }
}

afterEach(() => {
  if (root) {
    act(() => {
      root!.unmount();
    });
    root = undefined;
  }
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
});

describe("PredictionMarketChart on TUI", () => {
  test("does not draw a kitty plot", async () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    testSetup = await createTestRenderer({ width: 80, height: 16 });
    (testSetup.renderer as unknown as { _capabilities: unknown })._capabilities = {
      kitty_graphics: true,
      multiplexer: "none",
    };
    (testSetup.renderer as unknown as { _resolution: unknown })._resolution = {
      width: 800,
      height: 480,
    };

    root = createRoot(testSetup.renderer);
    act(() => {
      root!.render(<ChartHarness />);
    });

    await flushFrames();

    const manager = getNativeSurfaceManager(testSetup.renderer as never) as unknown as {
      surfaces: Map<string, unknown>;
    };
    expect([...manager.surfaces.keys()].some((id) => id.includes("chart"))).toBe(false);
    expect(testSetup.captureCharFrame()).toContain("Charts run on desktop and hosted web.");
  });
});
