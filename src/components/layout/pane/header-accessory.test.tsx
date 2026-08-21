import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { Box, Text } from "../../../ui";
import { testRender } from "../../../renderers/opentui/test-utils";
import { PaneHeader } from "./header";
import { PaneHeaderAccessoryProvider, usePaneHeaderAccessory } from "./header-accessory";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(async () => {
  if (testSetup) {
    await act(async () => testSetup?.renderer.destroy());
    testSetup = undefined;
  }
});

function TitlePresence() {
  usePaneHeaderAccessory("presence", () => ({
    width: 2,
    node: <Text> ●</Text>,
  }), []);
  return null;
}

function HeaderHarness({ title }: { title: string }) {
  return (
    <PaneHeaderAccessoryProvider>
      {(accessory) => (
        <Box width={40} height={1}>
          <TitlePresence />
          <PaneHeader
            title={title}
            width={40}
            focused
            titleAccessory={accessory?.node}
            titleAccessoryWidth={accessory?.width}
          />
        </Box>
      )}
    </PaneHeaderAccessoryProvider>
  );
}

describe("pane header accessory", () => {
  test("renders an accessory immediately after the title", async () => {
    await act(async () => {
      testSetup = await testRender(<HeaderHarness title="@spencer" />, {
        width: 40,
        height: 1,
      });
    });
    await act(async () => {
      await testSetup?.renderOnce();
    });

    const frame = testSetup?.captureCharFrame() ?? "";
    expect(frame).toContain("@spencer ●");
    expect(frame.indexOf("@spencer ●")).toBeGreaterThan(frame.indexOf("::"));
  });
});
