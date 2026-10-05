/** @jsxImportSource react */
import { expect, test } from "bun:test";
import { act } from "react";
import { createDomTestHarness } from "../test-utils";
import { WEB_CELL_WIDTH } from "../../../theme/font-scale";
import { WebDataTableHeader } from "./row";

const { window: testWindow, render } = createDomTestHarness({ withUi: false });

test("a header drag starts from the rendered width and a double-click resets it", async () => {
  const resized: number[] = [];
  let ended = 0;
  let reset = 0;
  let sorted = 0;
  const container = await render(
    <WebDataTableHeader
      columns={[
        { id: "name", label: "Name", width: 12 },
        { id: "price", label: "Price", width: 8 },
      ]}
      columnGap={1}
      horizontalPadding={1}
      focusPane={() => {}}
      gridTemplateColumns="160px 80px"
      onHeaderClick={() => { sorted += 1; }}
      onColumnResize={(_columnId, width) => resized.push(width)}
      onColumnResizeEnd={() => { ended += 1; }}
      onColumnResizeReset={() => { reset += 1; }}
      sortColumnId={null}
      sortDirection="asc"
    />,
  );
  const handle = container.querySelector('[data-gloom-role="data-table-column-resize"]') as HTMLElement;
  expect(handle).not.toBeNull();
  expect(handle.getAttribute("aria-label")).toBe("Resize Name column");
  handle.parentElement!.getBoundingClientRect = () => ({ width: 20 * WEB_CELL_WIDTH } as DOMRect);

  await act(async () => {
    handle.dispatchEvent(new testWindow.MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
  });
  expect(sorted).toBe(0);

  const label = container.querySelector('[data-gloom-role="data-table-header-cell"] span') as HTMLElement;
  await act(async () => {
    label.dispatchEvent(new testWindow.MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
  });
  expect(sorted).toBe(1);

  await act(async () => {
    handle.dispatchEvent(new testWindow.PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 40,
      pointerId: 1,
      isPrimary: true,
    }));
  });
  await act(async () => {
    testWindow.document.dispatchEvent(new testWindow.PointerEvent("pointermove", {
      bubbles: true,
      clientX: 40 + WEB_CELL_WIDTH,
      pointerId: 1,
    }));
  });
  await act(async () => {
    testWindow.document.dispatchEvent(new testWindow.PointerEvent("pointerup", {
      bubbles: true,
      clientX: 40 + WEB_CELL_WIDTH,
      pointerId: 1,
    }));
  });
  expect(resized).toEqual([21]);
  expect(ended).toBe(1);

  await act(async () => {
    handle.dispatchEvent(new testWindow.MouseEvent("dblclick", { bubbles: true, cancelable: true }));
  });
  expect(reset).toBe(1);
  expect(sorted).toBe(1);
});
