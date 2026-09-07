import { TextAttributes } from "@opentui/core";
import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "../../renderers/opentui/test-utils";
import { AppContext, PaneInstanceProvider, createInitialState } from "../../state/app/context";
import { colors } from "../../theme/colors";
import { createDefaultConfig } from "../../types/config";
import { FeedDataTableStackView } from "./stack-view";
import { setLanguage } from "../../i18n";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(async () => {
  await act(async () => testSetup?.renderer.destroy());
  testSetup = undefined;
  setLanguage("en");
});

test("rebuilds translated columns when the app language changes", async () => {
  const state = createInitialState(createDefaultConfig("/tmp/gloomberb-feed-table-language"));
  const items = [{ id: "story", eyebrow: "Wire", title: "Story", timestamp: "2026-01-01" }];
  testSetup = await testRender(
    <AppContext value={{ state, dispatch: () => {} }}>
      <PaneInstanceProvider paneId="news:test">
        <FeedDataTableStackView
          width={80}
          height={8}
          focused
          items={items}
          selectedIdx={0}
          onSelect={() => {}}
          sourceLabel="Source"
          titleLabel="Headline"
        />
      </PaneInstanceProvider>
    </AppContext>,
    { width: 80, height: 8 },
  );
  await act(async () => testSetup?.renderOnce());
  expect(testSetup.captureCharFrame()).toContain("Source");

  await act(async () => {
    setLanguage("zh-CN");
    await testSetup?.renderOnce();
    await testSetup?.renderOnce();
  });
  expect(testSetup.captureCharFrame()).toContain("来源");
});

function rgba(hex: string): string {
  const value = hex.slice(1);
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16)).concat(255).join(",");
}

test("mutes opened headlines even while the row is selected", async () => {
  const state = createInitialState(createDefaultConfig("/tmp/gloomberb-feed-table-read"));
  testSetup = await testRender(
    <AppContext value={{ state, dispatch: () => {} }}>
      <PaneInstanceProvider paneId="news:test">
        <FeedDataTableStackView
          width={80}
          height={8}
          focused
          items={[
            { id: "unread", eyebrow: "Wire", title: "Unread story", timestamp: "2026-01-01" },
            { id: "read", eyebrow: "Wire", title: "Read story", timestamp: "2026-01-01" },
          ]}
          selectedIdx={1}
          onSelect={() => {}}
          isItemRead={(item) => item.id === "read"}
        />
      </PaneInstanceProvider>
    </AppContext>,
    { width: 80, height: 8 },
  );

  await act(async () => {
    await testSetup?.renderOnce();
    await testSetup?.renderOnce();
  });

  const spans = testSetup!.captureSpans().lines.flatMap((line) => line.spans);
  const unreadSpan = spans.find((span) => span.text.includes("Unread story"));
  const readSpan = spans.find((span) => span.text.includes("Read story"));

  expect((unreadSpan?.attributes ?? 0) & TextAttributes.BOLD).toBe(TextAttributes.BOLD);
  expect(unreadSpan?.fg.toInts().join(",")).toBe(rgba(colors.text));
  expect((readSpan?.attributes ?? 0) & TextAttributes.BOLD).toBe(0);
  expect(readSpan?.fg.toInts().join(",")).toBe(rgba(colors.textMuted));
});
