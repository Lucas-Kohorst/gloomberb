import { afterEach, expect, test } from "bun:test";
import { testRender } from "../../../renderers/opentui/test-utils";
import { JinaArticleReader, type JinaArticleState } from "./jina-reader";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

const OK_STATE: JinaArticleState = {
  content: null,
  loading: false,
  error: null,
  failureMessage: null,
  failureKind: null,
};

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
});

test("renders the extracted article body", async () => {
  testSetup = await testRender(
    <JinaArticleReader
      title="Strait watch"
      url="https://example.com/story"
      width={80}
      height={24}
      focused
      state={{ ...OK_STATE, content: "Tehran signals it may close the strait." }}
    />,
    { width: 80, height: 24 },
  );

  await testSetup.renderOnce();
  expect(testSetup.captureCharFrame()).toContain("Tehran signals it may close the strait.");
});

test("shows a full-text-unavailable state when extraction is blocked", async () => {
  testSetup = await testRender(
    <JinaArticleReader
      title="Blocked story"
      url="https://example.com/blocked"
      width={80}
      height={24}
      focused
      state={{
        ...OK_STATE,
        error: "blocked",
        failureMessage: "The publisher blocked automated extraction.",
        failureKind: "blocked",
      }}
    />,
    { width: 80, height: 24 },
  );

  await testSetup.renderOnce();
  expect(testSetup.captureCharFrame()).toContain("Full text unavailable.");
});
