import { afterEach, expect, test } from "bun:test";
import { testRender } from "../../../../renderers/opentui/test-utils";
import { getMessageBodyTokenLines } from "../layout";
import { ResponsiveTickerBadgeText } from "./inline-tokens";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(() => {
  testSetup?.renderer.destroy();
  testSetup = undefined;
});

// The terminal path pre-wraps into token lines before rendering, so emphasis has
// to survive both the tokenizer and the wrapper to reach the screen.
test("renders pre-wrapped markdown emphasis without the markers", async () => {
  const lines = getMessageBodyTokenLines("**ship it** with `raw code` and ~~doubt~~", 40, {});

  testSetup = await testRender(
    <>
      {lines.map((line, index) => (
        <ResponsiveTickerBadgeText
          key={index}
          tokens={line}
          prewrapped
          catalog={{}}
          textColor="#ffffff"
          openTicker={() => {}}
        />
      ))}
    </>,
    { width: 44, height: 6 },
  );
  await testSetup.renderOnce();

  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("ship it with raw code and doubt");
  expect(frame).not.toContain("*");
  expect(frame).not.toContain("`");
  expect(frame).not.toContain("~");
});
