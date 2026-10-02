import { TextAttributes } from "@opentui/core";
import { afterEach, expect, test } from "bun:test";
import { act, useReducer, useState } from "react";
import { testRender } from "../../renderers/opentui/test-utils";
import { AppContext, PaneInstanceProvider, appReducer, createInitialState } from "../../state/app/context";
import { colors } from "../../theme/colors";
import { createDefaultConfig } from "../../types/config";
import { FeedDataTableStackView, type FeedDataTableItem } from "./stack-view";
import { setLanguage } from "../../i18n";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(async () => {
  await act(async () => testSetup?.renderer.destroy());
  testSetup = undefined;
  setLanguage("en");
});

test("returns to the same selected item after live arrivals and header sorting", async () => {
  const opened: string[] = [];
  const initialItems: FeedDataTableItem[] = [
    { id: "a", title: "Alpha", timestamp: "2026-09-29", detailBody: "Alpha content" },
    { id: "b", title: "Bravo", timestamp: "2026-09-28", detailBody: "Bravo content" },
    { id: "c", title: "Charlie", timestamp: "2026-09-27", detailBody: "Charlie content" },
  ];
  let replaceItems!: (items: FeedDataTableItem[]) => void;
  let resizeFeed!: (width: number) => void;
  function LiveFeed() {
    const [width, setWidth] = useState(60);
    resizeFeed = setWidth;
    const [items, setItems] = useState(initialItems);
    const [selectedId, setSelectedId] = useState<string | null>("b");
    replaceItems = setItems;
    const state = createInitialState(createDefaultConfig("/tmp/gloomberb-feed-live"));
    return (
      <AppContext value={{ state, dispatch: () => {} }}>
        <PaneInstanceProvider paneId="feed-live">
          <FeedDataTableStackView
            width={width} height={10} focused items={items}
            selectedItemId={selectedId}
            onSelect={(index) => setSelectedId(items[index]?.id ?? null)}
            onOpenItem={(item) => { opened.push(item.id); }}
          />
        </PaneInstanceProvider>
      </AppContext>
    );
  }
  testSetup = await testRender(<LiveFeed />, { width: 60, height: 10 });
  await act(async () => { await testSetup!.renderOnce(); });
  const header = testSetup.captureCharFrame().split("\n")[0]!;
  await act(async () => { await testSetup!.mockMouse.click(header.indexOf("Headline") + 1, 0); });
  await act(async () => { testSetup!.mockInput.pressEnter(); });
  expect(opened).toEqual(["b"]);
  await act(async () => {
    replaceItems([{ id: "new", title: "New arrival", timestamp: "2026-09-30" }, ...initialItems]);
  });
  await act(async () => { await testSetup!.renderOnce(); });
  expect(testSetup.captureCharFrame()).toContain("Bravo content");
  await act(async () => { await testSetup!.mockMouse.click(2, 0); });
  await act(async () => { await testSetup!.renderOnce(); });
  const frame = testSetup.captureCharFrame();
  expect(frame.indexOf("Alpha")).toBeLessThan(frame.indexOf("Bravo"));
  expect(frame.indexOf("Bravo")).toBeLessThan(frame.indexOf("New arrival"));
  await act(async () => {
    resizeFeed(24);
    testSetup!.resize(24, 10);
  });
  await act(async () => { await testSetup!.renderOnce(); });
  expect(testSetup.captureCharFrame()).toContain("Headline");
  expect(testSetup.captureCharFrame()).toContain("Bravo");
  await act(async () => { await testSetup!.mockMouse.click(2, 0); });
  await act(async () => { await testSetup!.renderOnce(); });
  const narrowFrame = testSetup.captureCharFrame();
  expect(narrowFrame.indexOf("New arrival")).toBeLessThan(narrowFrame.indexOf("Bravo"));
  await act(async () => {
    resizeFeed(60);
    testSetup!.resize(60, 10);
  });
  await act(async () => { await testSetup!.renderOnce(); });
  expect(testSetup.captureCharFrame()).toContain("Source");
  await act(async () => { testSetup!.mockInput.pressEnter(); });
  expect(opened).toEqual(["b", "b"]);
});

test("restores a scrolled feed after its columns change while reading detail", async () => {
  const items = Array.from({ length: 100 }, (_, index) => ({ id: String(index), title: `Record ${index}`, detailBody: `Detail ${index}` }));
  let setWidth!: (width: number) => void;
  function Feed() {
    const [state, dispatch] = useReducer(appReducer, createInitialState(createDefaultConfig("/tmp/gloomberb-feed-scroll")));
    const [width, resize] = useState(60);
    const [selectedId, setSelectedId] = useState<string | null>("0");
    setWidth = resize;
    return (
      <AppContext value={{ state, dispatch }}>
        <PaneInstanceProvider paneId="feed-scroll">
          <FeedDataTableStackView width={width} height={10} focused items={items}
            selectedItemId={selectedId} onSelect={(index) => setSelectedId(items[index]!.id)} />
        </PaneInstanceProvider>
      </AppContext>
    );
  }
  testSetup = await testRender(<Feed />, { width: 60, height: 10 });
  const settle = async () => {
    for (let frame = 0; frame < 4; frame++) await act(async () => { await testSetup!.renderOnce(); });
  };
  await settle();
  await act(async () => {
    for (let i = 0; i < 12; i++) await testSetup!.mockMouse.scroll(30, 5, "down");
  });
  await settle();
  const firstVisible = testSetup.captureCharFrame().split("\n")[1]!.match(/Record \d+/)?.[0];
  expect(firstVisible).toBe("Record 12");
  await act(async () => { await testSetup!.mockMouse.click(30, 4); });
  await act(async () => { testSetup!.mockInput.pressEnter(); });
  await settle();
  expect(testSetup.captureCharFrame()).toContain("Detail");
  await act(async () => { setWidth(24); testSetup!.resize(24, 10); });
  await settle();
  await act(async () => { await testSetup!.mockMouse.click(2, 0); });
  await settle();
  expect(testSetup.captureCharFrame().split("\n")[1]).toContain(firstVisible!);
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

test("calendar dates retain the source day while instants keep local formatting", async () => {
  const items: FeedDataTableItem[] = [
    { id: "period", title: "Reporting period", timestamp: new Date("2024-12-31T00:00:00Z"), timestampKind: "date" },
    { id: "earlier", title: "Earlier period", timestamp: "2024-12-30", timestampKind: "date" },
    { id: "year", title: "Year precision", timestamp: "2024-01-01", timestampKind: "date", datePrecision: "year" },
    { id: "month", title: "Month precision", timestamp: "2024-06-01", timestampKind: "date", datePrecision: "month" },
    { id: "event", title: "Event instant", timestamp: "2024-12-31T00:00:00Z" },
  ];
  const state = createInitialState(createDefaultConfig("/tmp/gloomberb-calendar-dates"));
  let resize!: (width: number) => void;
  function Harness() {
    const [width, setWidth] = useState(70);
    resize = setWidth;
    const [selectedId, setSelectedId] = useState<string | null>("period");
    return <AppContext value={{ state, dispatch: () => {} }}>
      <PaneInstanceProvider paneId="calendar-dates">
        <FeedDataTableStackView items={items} width={width} height={10} focused
          selectedItemId={selectedId} onSelect={(index) => setSelectedId(items[index]?.id ?? null)} />
      </PaneInstanceProvider>
    </AppContext>;
  }
  testSetup = await testRender(<Harness />, { width: 70, height: 10 });
  for (let i = 0; i < 3; i++) await act(async () => { await testSetup!.renderOnce(); });
  let lines = testSetup.captureCharFrame().split("\n");
  expect(lines.find((line) => line.includes("Reporting period"))).toContain("2024-12-31");
  expect(lines.find((line) => line.includes("Earlier period"))).toContain("2024-12-30");
  expect(lines.find((line) => line.includes("Year precision"))).toMatch(/2024\s+Year precision/);
  expect(lines.find((line) => line.includes("Month precision"))).toMatch(/2024-06\s+Month precision/);
  const localDate = new Date("2024-12-31T00:00:00Z").toLocaleDateString("en-US", {month:"numeric",day:"numeric",year:"2-digit"});
  expect(lines.find((line) => line.includes("Event instant"))).toContain(localDate);
  await act(async () => { await testSetup!.mockMouse.click(3, 0); });
  for (let i = 0; i < 3; i++) await act(async () => { await testSetup!.renderOnce(); });
  lines = testSetup.captureCharFrame().split("\n");
  expect(lines.findIndex((line) => line.includes("Earlier period"))).toBeLessThan(lines.findIndex((line) => line.includes("Reporting period")));
  await act(async () => { resize(24); });
  for (let i = 0; i < 3; i++) await act(async () => { await testSetup!.renderOnce(); });
  expect(testSetup.captureCharFrame()).toContain("Reporting period");
  await act(async () => { resize(70); });
  for (let i = 0; i < 3; i++) await act(async () => { await testSetup!.renderOnce(); });
  expect(testSetup.captureCharFrame()).toContain("2024-12-31");
});
