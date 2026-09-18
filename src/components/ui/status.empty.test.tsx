import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "../../renderers/opentui/test-utils";
import { Box } from "../../ui";
import { EmptyState } from "./status";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(async () => {
  if (!testSetup) return;
  await act(async () => {
    testSetup!.renderer.destroy();
  });
  testSetup = undefined;
});

async function frameOf(node: Parameters<typeof testRender>[0], width: number, height = 8) {
  testSetup = await testRender(node, { width, height });
  await act(async () => {
    await testSetup!.renderOnce();
    await testSetup!.renderOnce();
  });
  return testSetup.captureCharFrame();
}

function assertReadableCommandBarHint(frame: string) {
  expect(frame).not.toContain("Pctoradd");
  expect(frame).toMatch(/Press Ctrl\+P/);
  expect(frame).toMatch(/to add one/);
}

describe("EmptyState command-bar hint", () => {
  test("title and hint stay on separate readable lines", async () => {
    const frame = await frameOf(
      <EmptyState fill={false} title="No tickers." hint="Press Ctrl+P to add one." />,
      45,
    );
    expect(frame).toContain("No tickers.");
    assertReadableCommandBarHint(frame);
  });

  test("does not overlap Ctrl+P with to add one inside a padded auto-height box", async () => {
    const frame = await frameOf(
      <Box width="100%" paddingX={1} paddingY={1}>
        <EmptyState title="No tickers." hint="Press Ctrl+P to add one." />
      </Box>,
      45,
      16,
    );
    assertReadableCommandBarHint(frame);
  });
});
