/** @jsxImportSource react */
import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WebDataTableRow } from "./row";

const testWindow = new Window({ url: "http://localhost" });
Object.assign(globalThis, {
  window: testWindow,
  document: testWindow.document,
  IS_REACT_ACT_ENVIRONMENT: true,
});
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  testWindow.document.body.innerHTML = "";
});

type Row = { id: string; title: string };
const item: Row = { id: "first", title: "First row" };
const columns = [{ id: "title", label: "Title", width: 12, align: "left" as const }];

function dispatchMouseDown(
  target: Element,
  options: { button?: number; detail?: number } = {},
) {
  target.dispatchEvent(new testWindow.MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
    button: options.button ?? 0,
    detail: options.detail ?? 1,
    clientX: 8,
    clientY: 8,
  }));
}

async function mountRow(options: {
  activate?: boolean;
  onRowMouseDown?: () => boolean | void;
  cellMouseDown?: () => void;
} = {}) {
  const selected: string[] = [];
  const activated: string[] = [];
  const container = testWindow.document.createElement("div");
  testWindow.document.body.append(container);
  root = createRoot(container as unknown as HTMLElement);
  await act(async () => root!.render(
    <WebDataTableRow
      columns={columns}
      columnGap={1}
      horizontalPadding={1}
      focusPane={() => {}}
      onActivateRow={options.activate === false
        ? undefined
        : (row) => activated.push(row.title)}
      onSelectRow={(row) => selected.push(row.title)}
      onRowMouseDown={options.onRowMouseDown}
      index={0}
      item={item}
      itemKey={item.id}
      gridTemplateColumns="100px"
      frozenColumnId={null}
      renderCell={(row) => ({
        text: row.title,
        onMouseDown: options.cellMouseDown,
      })}
      rowSize={18}
      rowStart={0}
      rowContextMenuSurface={false}
      selected={false}
    />,
  ));
  return {
    row: container.querySelector('[data-gloom-role="data-table-row"]')!,
    cell: container.querySelector('[data-gloom-role="data-table-cell"]')!,
    selected,
    activated,
  };
}

test("a primary click enters an activatable row instead of only selecting it", async () => {
  const probe = await mountRow();
  expect(probe.row.getAttribute("data-gloom-interactive")).toBe("true");
  await act(async () => dispatchMouseDown(probe.cell));
  expect(probe.activated).toEqual(["First row"]);
  expect(probe.selected).toEqual([]);
});

test("a second mousedown from a double-click does not enter the row twice", async () => {
  const probe = await mountRow();
  await act(async () => {
    dispatchMouseDown(probe.cell, { detail: 1 });
    dispatchMouseDown(probe.cell, { detail: 2 });
  });
  expect(probe.activated).toEqual(["First row"]);
});

test("a primary click only selects when the row cannot be entered", async () => {
  const probe = await mountRow({ activate: false });
  await act(async () => dispatchMouseDown(probe.cell));
  expect(probe.selected).toEqual(["First row"]);
  expect(probe.activated).toEqual([]);
});

test("a non-primary click does not enter the row", async () => {
  const probe = await mountRow();
  await act(async () => dispatchMouseDown(probe.cell, { button: 2 }));
  expect(probe.activated).toEqual([]);
  expect(probe.selected).toEqual([]);
});

test("a cell mouse handler keeps the row from entering", async () => {
  let cellClicks = 0;
  const probe = await mountRow({ cellMouseDown: () => { cellClicks += 1; } });
  await act(async () => dispatchMouseDown(probe.cell));
  expect(cellClicks).toBe(1);
  expect(probe.activated).toEqual([]);
  expect(probe.selected).toEqual([]);
});

test("a handled row mouse-down keeps the row from entering", async () => {
  const probe = await mountRow({ onRowMouseDown: () => true });
  await act(async () => dispatchMouseDown(probe.cell));
  expect(probe.activated).toEqual([]);
  expect(probe.selected).toEqual([]);
});
