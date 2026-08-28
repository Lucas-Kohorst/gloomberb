import { afterEach, describe, expect, test } from "bun:test";
import { act, type Dispatch } from "react";
import { testRender } from "../../../../renderers/opentui/test-utils";
import {
  AppProvider,
  createInitialState,
  useAppDispatch,
  useAppSelector,
  type AppAction,
} from "../../../../state/app/context";
import { createDefaultConfig } from "../../../../types/config";
import { selectLiveDeskContext } from "./live-desk";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;
let capturedDispatch: Dispatch<AppAction> | null = null;

function DispatchCapture() {
  capturedDispatch = useAppDispatch();
  return null;
}

function LiveDeskHarness() {
  const desk = useAppSelector(selectLiveDeskContext);
  const preview = desk.slice(0, 48);
  return <text>{preview}</text>;
}

describe("live desk selector", () => {
  afterEach(async () => {
    if (testSetup) {
      await act(async () => {
        testSetup?.renderer.destroy();
      });
    }
    testSetup = undefined;
    capturedDispatch = null;
  });

  test("returns the same string for the same app state", () => {
    const state = createInitialState(createDefaultConfig("/tmp/gloomberb-live-desk"));
    expect(selectLiveDeskContext(state)).toBe(selectLiveDeskContext(state));
    expect(selectLiveDeskContext(state)).toContain("Live desk:");
  });

  test("does not infinite-loop under AppProvider after an unrelated update", async () => {
    testSetup = await testRender(
      <AppProvider config={createDefaultConfig("/tmp/gloomberb-live-desk-store")}>
        <DispatchCapture />
        <LiveDeskHarness />
      </AppProvider>,
      { width: 48, height: 4 },
    );
    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain("Live desk");

    await act(() => {
      capturedDispatch?.({ type: "SET_COMMAND_BAR", open: true, query: "ticker" });
    });
    await testSetup.renderOnce();
    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain("Live desk");
  });
});
