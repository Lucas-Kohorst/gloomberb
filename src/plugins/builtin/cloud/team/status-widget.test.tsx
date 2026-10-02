import { afterEach, describe, expect, test } from "bun:test";
import { Fragment, act } from "react";
import { Box, Text } from "../../../../ui";
import { testRender } from "../../../../renderers/opentui/test-utils";
import { teamStatusChipText } from "./status-widget";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(async () => {
  if (testSetup) {
    await act(async () => testSetup?.renderer.destroy());
    testSetup = undefined;
  }
});

describe("team status chip", () => {
  test("puts one space before the count and one space between chips", async () => {
    expect(teamStatusChipText("ADJ", 1)).toBe("ADJ [1]");
    expect(teamStatusChipText("BLUE", 0)).toBe("BLUE");

    await act(async () => {
      testSetup = await testRender(
        <Box flexDirection="row" gap={1}>
          <Text>@ lucas</Text>
          <Box flexDirection="row" gap={1}>
            <Text>{teamStatusChipText("ADJ", 1)}</Text>
            <Text>{teamStatusChipText("BLUE", 0)}</Text>
          </Box>
        </Box>,
        { width: 40, height: 1 },
      );
    });
    await act(async () => { await testSetup?.renderOnce(); });

    const line = (testSetup?.captureCharFrame() ?? "").split("\n")[0] ?? "";
    expect(line).toContain("@ lucas ADJ [1] BLUE");
    expect(line).not.toContain("ADJ[1]");
    expect(line).not.toContain("lucas  ADJ");
  });

  test("a fragment of status chips still gets one cell between them", async () => {
    await act(async () => {
      testSetup = await testRender(
        <Box flexDirection="row" gap={1}>
          <Fragment>
            <Text>@ lucas</Text>
            <Text>ADJ</Text>
          </Fragment>
        </Box>,
        { width: 40, height: 1 },
      );
    });
    await act(async () => { await testSetup?.renderOnce(); });

    const line = (testSetup?.captureCharFrame() ?? "").split("\n")[0] ?? "";
    expect(line).toContain("@ lucas ADJ");
    expect(line).not.toContain("lucas  ADJ");
  });
});
