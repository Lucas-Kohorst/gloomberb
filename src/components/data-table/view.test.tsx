import { afterEach, describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { testRender } from "../../renderers/opentui/test-utils";
import {
  AppContext,
  PaneInstanceProvider,
  createInitialState,
} from "../../state/app/context";
import { createDefaultConfig } from "../../types/config";
import { Box, Text } from "../../ui";
import { DataTableView } from "./view";
import type { DataTableCell, DataTableColumn } from "../ui";
import {
  getActivePaneCsvSnapshot,
  PANE_CSV_MAX_ROWS,
  resetPaneCsvSnapshots,
  serializePaneCsv,
} from "./csv-export";

type Row =
  | { type: "section"; id: string; title: string }
  | { type: "row"; id: string; title: string };

type Column = DataTableColumn & { id: "title" };

const rows: Row[] = [
  { type: "section", id: "section", title: "Group" },
  { type: "row", id: "first", title: "First row" },
  { type: "row", id: "second", title: "Second row" },
  { type: "row", id: "third", title: "Third row" },
];
const largeRows: Row[] = Array.from({ length: 1_000 }, (_, index) => ({
  type: "row",
  id: `row-${index}`,
  title: `Row ${index}`,
}));

const columns: Column[] = [
  { id: "title", label: "Title", width: 20, align: "left" },
];

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(async () => {
  resetPaneCsvSnapshots();
  setCsvItems = null;
  csvCellWalks = 0;
  if (!testSetup) return;
  await act(async () => {
    testSetup!.renderer.destroy();
  });
  testSetup = undefined;
});

function Harness() {
  const [selectedIndex, setSelectedIndex] = useState(1);
  const [cursorIndex, setCursorIndex] = useState(1);
  const [activatedTitle, setActivatedTitle] = useState("");
  const state = createInitialState(
    createDefaultConfig("/tmp/gloomberb-data-table-view-test"),
  );
  const selectedTitle = rows[selectedIndex]?.title ?? "none";
  const cursorTitle = rows[cursorIndex]?.title ?? "none";

  return (
    <AppContext value={{ state, dispatch: () => {} }}>
      <PaneInstanceProvider paneId="data-table-view-test">
        <DataTableView<Row, Column>
          focused
          isNavigable={(row) => row.type === "row"}
          selection={{
            kind: "index",
            selectedIndex,
            onChange: (index) => setSelectedIndex(index),
          }}
          onCursorChange={(_row, index) => setCursorIndex(index)}
          onActivate={(row) => {
            if (row.type === "row") setActivatedTitle(row.title);
          }}
          columns={columns}
          items={rows}
          sortColumnId={null}
          sortDirection="asc"
          onHeaderClick={() => undefined}
          getItemKey={(row) => row.id}
          renderSectionHeader={(row) => row.type === "section"
            ? { text: row.title }
            : null}
          renderCell={(row): DataTableCell => ({
            text: row.type === "row" ? row.title : "",
          })}
          emptyStateTitle="No rows"
          rootAfter={
            <Box height={1}>
              <Text>{`cursor=${cursorTitle} selected=${selectedTitle} activated=${activatedTitle}`}</Text>
            </Box>
          }
        />
      </PaneInstanceProvider>
    </AppContext>
  );
}

let setCsvItems: ((items: Row[]) => void) | null = null;
let csvCellWalks = 0;

function CsvExportHarness({
  initialItems,
}: {
  initialItems: Row[];
}) {
  const [items, setItems] = useState(initialItems);
  setCsvItems = setItems;
  const state = createInitialState(
    createDefaultConfig("/tmp/gloomberb-data-table-csv-test"),
  );

  return (
    <AppContext value={{ state, dispatch: () => {} }}>
      <PaneInstanceProvider paneId="data-table-csv-test">
        <DataTableView<Row, Column>
          focused
          selection={{
            kind: "index",
            selectedIndex: 0,
            onChange: () => {},
          }}
          columns={columns}
          items={items}
          sortColumnId={null}
          sortDirection="asc"
          onHeaderClick={() => undefined}
          getItemKey={(row) => row.id}
          renderCell={(row): DataTableCell => {
            csvCellWalks += 1;
            return { text: row.title };
          }}
          emptyStateTitle="No rows"
        />
      </PaneInstanceProvider>
    </AppContext>
  );
}

function LargeSelectionHarness({
  onIsSelected,
}: {
  onIsSelected: () => void;
}) {
  const state = createInitialState(
    createDefaultConfig("/tmp/gloomberb-data-table-view-large-test"),
  );

  return (
    <AppContext value={{ state, dispatch: () => {} }}>
      <PaneInstanceProvider paneId="data-table-view-large-test">
        <DataTableView<Row, Column>
          focused
          selection={{
            kind: "index",
            selectedIndex: 500,
            onChange: () => {},
          }}
          columns={columns}
          items={largeRows}
          sortColumnId={null}
          sortDirection="asc"
          onHeaderClick={() => undefined}
          getItemKey={(row) => row.id}
          renderCell={(row, _column, index): DataTableCell => {
            onIsSelected();
            return { text: row.title + (index === 500 ? "" : "") };
          }}
          emptyStateTitle="No rows"
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

async function emitKeypress(event: {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  option?: boolean;
  defaultPrevented?: boolean;
  propagationStopped?: boolean;
}) {
  await act(async () => {
    testSetup!.renderer.keyInput.emit("keypress", {
      ctrl: false,
      meta: false,
      option: false,
      shift: false,
      eventType: "press",
      repeated: false,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault: () => {},
      stopPropagation: () => {},
      ...event,
    } as any);
    await testSetup!.renderOnce();
  });
}

async function emitKeypressBatch(events: Array<{
  name?: string;
  sequence?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  option?: boolean;
}>) {
  await act(async () => {
    for (const event of events) {
      testSetup!.renderer.keyInput.emit("keypress", {
        ctrl: false,
        meta: false,
        option: false,
        shift: false,
        eventType: "press",
        repeated: false,
        defaultPrevented: false,
        propagationStopped: false,
        preventDefault: () => {},
        stopPropagation: () => {},
        ...event,
      } as any);
    }
    await testSetup!.renderOnce();
  });
}

describe("DataTableView", () => {
  test("owns row keyboard navigation and skips section headers", async () => {
    testSetup = await testRender(<Harness />, { width: 60, height: 12 });

    await renderSettled();
    expect(testSetup.captureCharFrame()).toContain("cursor=First row selected=First row");

    await emitKeypress({ name: "down", sequence: "\u001B[B" });
    await renderSettled();
    expect(testSetup.captureCharFrame()).toContain("cursor=Second row selected=First row");

    await emitKeypress({ name: "up", sequence: "\u001B[A", meta: true });
    await renderSettled();
    expect(testSetup.captureCharFrame()).toContain("cursor=Second row selected=First row");

    await emitKeypress({ name: "up", sequence: "\u001B[A" });
    await renderSettled();
    expect(testSetup.captureCharFrame()).toContain("cursor=First row selected=First row");

    await emitKeypress({ name: "j", sequence: "j" });
    await emitKeypress({ name: "k", sequence: "k" });
    await renderSettled();
    expect(testSetup.captureCharFrame()).toContain("cursor=First row selected=First row");

    await emitKeypress({ name: "enter", sequence: "\r" });
    await renderSettled();
    expect(testSetup.captureCharFrame()).toContain("activated=First row");

    await emitKeypress({ name: "j", sequence: "j" });
    await renderSettled();
    expect(testSetup.captureCharFrame()).toContain("cursor=Second row selected=First row activated=First row");

    await emitKeypress({ name: "enter", sequence: "\r", defaultPrevented: true });
    await renderSettled();
    expect(testSetup.captureCharFrame()).toContain("cursor=Second row selected=First row activated=First row");
  });

  test("keeps selection current across repeated keypresses before the next render", async () => {
    testSetup = await testRender(<Harness />, { width: 60, height: 12 });

    await renderSettled();
    await emitKeypressBatch([
      { name: "down", sequence: "\u001B[B" },
      { name: "down", sequence: "\u001B[B" },
      { name: "enter", sequence: "\r" },
    ]);
    await renderSettled();

    expect(testSetup.captureCharFrame()).toContain("selected=Third row activated=Third row");
  });

  test("keeps CSV export on demand across item identity changes", async () => {
    csvCellWalks = 0;
    const firstItems = largeRows.map((row) => ({ ...row, title: `${row.title}-v1` }));
    testSetup = await testRender(
      <CsvExportHarness initialItems={firstItems} />,
      { width: 60, height: 12 },
    );

    await renderSettled();
    const snapshot = getActivePaneCsvSnapshot();
    const afterRenderWalks = csvCellWalks;
    expect(snapshot).not.toBeNull();
    expect(afterRenderWalks).toBeLessThan(150);

    for (let tick = 0; tick < 8; tick += 1) {
      const nextItems = firstItems.map((row) => ({
        ...row,
        title: `${row.id}-v${tick + 2}`,
      }));
      await act(async () => {
        setCsvItems?.(nextItems);
        await testSetup!.renderOnce();
      });
    }

    expect(getActivePaneCsvSnapshot()).toBe(snapshot);
    expect(csvCellWalks - afterRenderWalks).toBeLessThan(firstItems.length);

    const beforeSerialize = csvCellWalks;
    const csv = serializePaneCsv(snapshot!);
    expect(csvCellWalks - beforeSerialize).toBe(firstItems.length);
    expect(csv.startsWith("Title\n")).toBe(true);
    expect(csv).toContain("row-0-v9");
    expect(csv).toContain("row-999-v9");
    expect(csv).not.toContain("Row 0-v1");
  });

  test("caps CSV serialization so a fat table does not walk every row", async () => {
    csvCellWalks = 0;
    const overCapRows: Row[] = Array.from({ length: PANE_CSV_MAX_ROWS + 40 }, (_, index) => ({
      type: "row",
      id: `row-${index}`,
      title: `Row ${index}`,
    }));
    testSetup = await testRender(
      <CsvExportHarness initialItems={overCapRows} />,
      { width: 60, height: 12 },
    );

    await renderSettled();
    const snapshot = getActivePaneCsvSnapshot();
    expect(snapshot).not.toBeNull();
    const afterRenderWalks = csvCellWalks;
    expect(afterRenderWalks).toBeLessThan(150);

    const beforeSerialize = csvCellWalks;
    const csv = serializePaneCsv(snapshot!);
    expect(csvCellWalks - beforeSerialize).toBe(PANE_CSV_MAX_ROWS);
    expect(csv).toContain("Row 0");
    expect(csv).toContain(`Row ${PANE_CSV_MAX_ROWS - 1}`);
    expect(csv).not.toContain(`Row ${PANE_CSV_MAX_ROWS}`);
  });

  test("does not scan every row when the selected index is explicit", async () => {
    let isSelectedCalls = 0;
    testSetup = await testRender(
      <LargeSelectionHarness
        onIsSelected={() => {
          isSelectedCalls += 1;
        }}
      />,
      { width: 60, height: 12 },
    );

    await renderSettled();

    expect(isSelectedCalls).toBeLessThan(150);
  });
});
