import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "../../renderers/opentui/test-utils";
import { AppContext, createInitialState, type AppAction } from "../../state/app/context";
import { createDefaultConfig } from "../../types/config";
import { HeaderTickerSlot } from "./header-ticker-slot";
import { HEADER_COMMAND_BAR_PLACEHOLDER } from "./header-ticker";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
});

describe("HeaderTickerSlot", () => {
  test("clicking the header control opens the real command bar, not ticker search", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-header-command-bar");
    const state = createInitialState(config);
    const actions: AppAction[] = [];

    testSetup = await testRender(
      <AppContext value={{ state, dispatch: (action) => actions.push(action) }}>
        <HeaderTickerSlot />
      </AppContext>,
      { width: 40, height: 1 },
    );

    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    const clickX = frame.split("\n")[0]?.indexOf("Command") ?? -1;
    expect(clickX).toBeGreaterThanOrEqual(0);
    expect(frame).toContain(HEADER_COMMAND_BAR_PLACEHOLDER);

    await act(async () => {
      await testSetup!.mockMouse.click(clickX + 1, 0);
      await testSetup!.renderOnce();
    });

    expect(actions).toEqual([{ type: "SET_COMMAND_BAR", open: true, query: "" }]);
  });

  test("does not reset an already-open command bar", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-header-command-bar-open");
    const state = { ...createInitialState(config), commandBarOpen: true, commandBarQuery: "DES NVDA" };
    const actions: AppAction[] = [];

    testSetup = await testRender(
      <AppContext value={{ state, dispatch: (action) => actions.push(action) }}>
        <HeaderTickerSlot />
      </AppContext>,
      { width: 40, height: 1 },
    );

    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    const clickX = frame.split("\n")[0]?.indexOf("Command") ?? -1;
    expect(clickX).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.click(clickX + 1, 0);
      await testSetup!.renderOnce();
    });

    expect(actions).toEqual([]);
  });
});
