import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
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
  test("paints compact HELP labels in a single row without a pane title", async () => {
    const state = createInitialState(createDefaultConfig("/tmp/gloomberb-pane-tab-header"));
    testSetup = await testRender(
      <AppContext value={{ state, dispatch: () => {} }}>
        <PaneTabHeader
          width={40}
          focused
          tabs={[
            { label: "Basics", value: "basics" },
            { label: "Functions", value: "functions" },
            { label: "Shortcuts", value: "shortcuts" },
            { label: "Issues", value: "issues" },
          ]}
          activeValue="basics"
          onSelect={() => {}}
        />
      </AppContext>,
    );
    await act(async () => {
      await testSetup!.renderOnce();
    });
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Basics");
    expect(frame).toContain("Functions");
    expect(frame).not.toContain("Help");
    expect(frame.split("\n").filter((line) => line.trim().length > 0)).toHaveLength(1);
  });
});
