import { afterEach, describe, expect, test } from "bun:test";
import { act, useReducer, useState } from "react";
import { testRender } from "../../renderers/opentui/test-utils";
import {
  AppContext,
  PaneInstanceProvider,
  createInitialState,
  appReducer,
} from "../../state/app/context";
import { createDefaultConfig } from "../../types/config";
import { Box, Text } from "../../ui";
import { DataTableStackView } from "./stack-view";
import type { DataTableCell, DataTableColumn } from "../ui";

interface Row {
  id: string;
  title: string;
  body: string;
  type?: "section" | "row";
}

type Column = DataTableColumn & { id: "title" };

const rows: Row[] = [
  { id: "first", title: "First row", body: "First detail" },
  { id: "second", title: "Second row", body: "Second detail" },
];
const groupedRows: Row[] = [
  { id: "first", title: "First row", body: "First detail", type: "row" },
  { id: "section", title: "Next day", body: "", type: "section" },
  { id: "second", title: "Second row", body: "Second detail", type: "row" },
];

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(async () => {
  if (!testSetup) return;
  await act(async () => {
    testSetup!.renderer.destroy();
  });
  testSetup = undefined;
});

function Harness() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [openRow, setOpenRow] = useState<Row | null>(null);
  const state = createInitialState(
    createDefaultConfig("/tmp/gloomberb-data-table-stack-view-test"),
  );
  const columns: Column[] = [
    { id: "title", label: "Title", width: 20, align: "left" },
  ];

  return (
    <AppContext value={{ state, dispatch: () => {} }}>
      <PaneInstanceProvider paneId="portfolio-list:main">
        <DataTableStackView<Row, Column>
          focused
          detailOpen={!!openRow}
          onBack={() => setOpenRow(null)}
          detailContent={
            openRow ? (
              <Box flexGrow={1}>
                <Text>{openRow.body}</Text>
              </Box>
            ) : (
              <Box flexGrow={1} />
            )
          }
          detailTitle={openRow?.title}
          selection={{
            kind: "index",
            selectedIndex,
            onChange: (index) => setSelectedIndex(index),
          }}
          onActivate={(row) => setOpenRow(row)}
          columns={columns}
          items={rows}
          sortColumnId={null}
          sortDirection="asc"
          onHeaderClick={() => undefined}
          getItemKey={(row) => row.id}
          renderCell={(row): DataTableCell => ({ text: row.title })}
          emptyStateTitle="No rows"
          showHorizontalScrollbar={false}
        />
      </PaneInstanceProvider>
    </AppContext>
  );
}

function GroupedHarness() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [cursorIndex, setCursorIndex] = useState(0);
  const state = createInitialState(
    createDefaultConfig("/tmp/gloomberb-data-table-stack-view-grouped-test"),
  );
  const columns: Column[] = [
    { id: "title", label: "Title", width: 20, align: "left" },
  ];
  const selectedTitle = groupedRows[cursorIndex]?.title ?? "none";

  return (
    <AppContext value={{ state, dispatch: () => {} }}>
      <PaneInstanceProvider paneId="portfolio-list:grouped">
        <DataTableStackView<Row, Column>
          focused
          detailOpen={false}
          onBack={() => {}}
          detailContent={<Box flexGrow={1} />}
          selection={{
            kind: "index",
            selectedIndex,
            onChange: (index) => setSelectedIndex(index),
          }}
          onCursorChange={(_row, index) => setCursorIndex(index)}
          isNavigable={(row) => row.type !== "section"}
          rootAfter={
            <Box height={1}>
              <Text>{`selected=${selectedTitle}`}</Text>
            </Box>
          }
          columns={columns}
          items={groupedRows}
          sortColumnId={null}
          sortDirection="asc"
          onHeaderClick={() => undefined}
          getItemKey={(row) => row.id}
          renderSectionHeader={(row) => row.type === "section"
            ? { text: row.title }
            : null}
          renderCell={(row): DataTableCell => ({
            text: row.type === "section" ? "" : row.title,
          })}
          emptyStateTitle="No rows"
          showHorizontalScrollbar={false}
        />
      </PaneInstanceProvider>
    </AppContext>
  );
}

async function renderSettled() {
  await act(async () => {
    await testSetup!.renderOnce();
    await testSetup!.renderOnce();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
  });
}

async function emitKeypress(event: { name?: string; sequence?: string }) {
  await act(async () => {
    testSetup!.renderer.keyInput.emit("keypress", {
      ctrl: false,
      meta: false,
      option: false,
      shift: false,
      eventType: "press",
      repeated: false,
      preventDefault: () => {},
      stopPropagation: () => {},
      ...event,
    } as any);
    await testSetup!.renderOnce();
  });
}

describe("DataTableStackView", () => {
  test("restores the scrolled list after opening a visible row before scroll persistence settles", async () => {
    const items = Array.from({ length: 100 }, (_, index) => ({ id: String(index), title: `Record ${index}`, body: `Detail ${index}` }));
    let savedScroll: number | undefined;
    function LongList() {
      const [state, dispatch] = useReducer(appReducer, createInitialState(createDefaultConfig("/tmp/gloomberb-stack-scroll")));
      const [selectedId, setSelectedId] = useState<string | null>("0");
      const [open, setOpen] = useState<Row | null>(null);
      savedScroll = state.paneState["long-list"]?.tableScrollPositions?.title;
      return (
        <AppContext value={{ state, dispatch }}>
          <PaneInstanceProvider paneId="long-list">
            <DataTableStackView<Row, Column>
              focused detailOpen={!!open} onBack={() => setOpen(null)}
              detailTitle={open?.title} detailContent={<Text>{open?.body ?? ""}</Text>}
              selection={{ kind: "id", selectedId, getId: (row) => row.id, onChange: setSelectedId }}
              onActivate={setOpen} items={items}
              columns={[{ id: "title", label: "Title", width: 30 }]}
              getItemKey={(row) => row.id} renderCell={(row) => ({ text: row.title })}
              emptyStateTitle="No records"
            />
          </PaneInstanceProvider>
        </AppContext>
      );
    }
    testSetup = await testRender(<LongList />, { width: 40, height: 10 });
    await renderSettled();
    await act(async () => {
      for (let i = 0; i < 12; i++) await testSetup!.mockMouse.scroll(5, 5, "down");
    });
    await renderSettled();
    const before = testSetup.captureCharFrame().split("\n");
    expect(before[1]).not.toContain("Record 0");
    await act(async () => { await testSetup!.mockMouse.click(5, 4); });
    await emitKeypress({ name: "enter", sequence: "\r" });
    await renderSettled();
    expect(testSetup.captureCharFrame()).toContain("Detail");
    expect(savedScroll).toBe(12);
    await emitKeypress({ name: "escape", sequence: "\u001b" });
    await renderSettled();
    await renderSettled();
    expect(testSetup.captureCharFrame().split("\n")[1]).toBe(before[1]);
  });

  test("owns table navigation, detail open, and back navigation", async () => {
    testSetup = await testRender(<Harness />, { width: 60, height: 12 });

    await renderSettled();
    expect(testSetup.captureCharFrame()).toContain("First row");
    expect(testSetup.captureCharFrame()).not.toContain("j/k move");

    await emitKeypress({ name: "j", sequence: "j" });
    await emitKeypress({ name: "enter", sequence: "\r" });
    await renderSettled();

    const detailFrame = testSetup.captureCharFrame();
    expect(detailFrame).toContain("\u2190 Back");
    expect(detailFrame).toContain("\u2190 Back \u2502 Second row");
    expect(detailFrame).toContain("Second detail");

    await emitKeypress({ name: "escape", sequence: "\u001b" });
    await renderSettled();

    const rootFrame = testSetup.captureCharFrame();
    expect(rootFrame).toContain("Second row");
    expect(rootFrame).not.toContain("Second detail");
  });

  test("closes detail from backspace", async () => {
    testSetup = await testRender(<Harness />, { width: 60, height: 12 });

    await renderSettled();
    await emitKeypress({ name: "enter", sequence: "\r" });
    await renderSettled();
    expect(testSetup.captureCharFrame()).toContain("First detail");

    await emitKeypress({ name: "backspace", sequence: "\u007f" });
    await renderSettled();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("First row");
    expect(frame).not.toContain("First detail");
  });

  test("skips section rows while navigating through the stack view", async () => {
    testSetup = await testRender(<GroupedHarness />, { width: 60, height: 12 });

    await renderSettled();
    expect(testSetup.captureCharFrame()).toContain("selected=First row");

    await emitKeypress({ name: "j", sequence: "j" });
    await renderSettled();
    expect(testSetup.captureCharFrame()).toContain("selected=Second row");

    await emitKeypress({ name: "k", sequence: "k" });
    await renderSettled();
    expect(testSetup.captureCharFrame()).toContain("selected=First row");
  });
});
