import { afterEach, describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { testRender } from "../renderers/opentui/test-utils";
import { AppContext, createInitialState } from "../state/app/context";
import { createDefaultConfig } from "../types/config";
import { PaneTabHeader } from "./pane-tab-header";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(async () => {
  if (!testSetup) return;
  await act(async () => {
    testSetup!.renderer.destroy();
  });
  testSetup = undefined;
});

describe("PaneTabHeader", () => {
  test("keeps the active tab visible after the pane shrinks without changing selection", async () => {
    let resize!: (width: number) => void;
    function Harness() {
      const [width, setWidth] = useState(48);
      resize = setWidth;
      return (
        <PaneTabHeader
          width={width}
          focused
          tabs={[
            { label: "Basics", value: "basics" },
            { label: "Functions", value: "functions" },
            { label: "Shortcuts", value: "shortcuts" },
            { label: "Issues", value: "issues" },
          ]}
          activeValue="issues"
          onSelect={() => {}}
        />
      );
    }
    testSetup = await testRender(<Harness />, { width: 48, height: 5 });
    await act(async () => { await testSetup!.renderOnce(); });
    expect(testSetup.captureCharFrame()).toContain("Issues");
    await act(async () => { resize(18); });
    await act(async () => { await testSetup!.renderOnce(); });
    await act(async () => { await testSetup!.renderOnce(); });
    expect(testSetup.captureCharFrame()).toContain("Issues");
    expect(testSetup.captureCharFrame()).not.toContain("Basics");
  });

  test("keeps overflow tabs reachable with keyboard and mouse in a narrow pane", async () => {
    const state = createInitialState(createDefaultConfig("/tmp/gloomberb-pane-tab-header"));
    function Harness() {
      const [activeValue, setActiveValue] = useState("basics");
      return (
        <AppContext value={{ state, dispatch: () => {} }}>
          <PaneTabHeader
            width={20}
            focused
            tabs={[
              { label: "Basics", value: "basics" },
              { label: "Functions", value: "functions" },
              { label: "Shortcuts", value: "shortcuts" },
              { label: "Issues", value: "issues" },
            ]}
            activeValue={activeValue}
            onSelect={setActiveValue}
          />
        </AppContext>
      );
    }
    testSetup = await testRender(
      <Harness />,
      { width: 20, height: 5 },
    );
    await act(async () => {
      await testSetup!.renderOnce();
    });
    expect(testSetup.captureCharFrame()).toContain("Basics");
    for (let index = 0; index < 3; index++) {
      await act(async () => {
        testSetup!.mockInput.pressArrow("right");
      });
      await act(async () => { await testSetup!.renderOnce(); });
    }
    expect(testSetup.captureCharFrame()).toContain("Issues");
    expect(testSetup.captureCharFrame()).not.toContain("Basics");
    await act(async () => {
      for (let index = 0; index < 30; index++) await testSetup!.mockMouse.scroll(2, 0, "up");
    });
    await act(async () => { await testSetup!.renderOnce(); });
    expect(testSetup.captureCharFrame()).toContain("Basics");
    await act(async () => { await testSetup!.mockMouse.click(2, 0); });
    await act(async () => { await testSetup!.renderOnce(); });
    testSetup!.mockInput.pressArrow("right");
    await act(async () => { await testSetup!.renderOnce(); });
    expect(testSetup.captureCharFrame()).toContain("Functions");
  });
});
