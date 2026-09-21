import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "../renderers/opentui/test-utils";
import { Box, Text } from "../ui";
import { PaneBodyPad } from "./pane-body-pad";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(async () => {
  if (!testSetup) return;
  await act(async () => { testSetup!.renderer.destroy(); });
  testSetup = undefined;
});

describe("PaneBodyPad", () => {
  test("keeps body copy off the pane edge", async () => {
    testSetup = await testRender(
      <Box width={20} height={4}>
        <PaneBodyPad>
          <Text>Basics</Text>
        </PaneBodyPad>
      </Box>,
    );
    await act(async () => {
      await testSetup!.renderOnce();
    });
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Basics");
    expect(frame.startsWith("Basics")).toBe(false);
  });
});
