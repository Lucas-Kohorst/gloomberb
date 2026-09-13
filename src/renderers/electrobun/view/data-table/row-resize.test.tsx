/** @jsxImportSource react */
import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WebDataTableHeader } from "./row";
import { WEB_CELL_WIDTH } from "../input-host";

const testWindow = new Window({ url: "http://localhost" });
Object.assign(globalThis, { window: testWindow, document: testWindow.document, IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  testWindow.document.body.innerHTML = "";
});

async function mount() {
  const resized: number[] = [];
  let ended = 0;
  let reset = 0;
  let sorted = 0;
  const container = testWindow.document.createElement("div");
  testWindow.document.body.append(container);
  root = createRoot(container as unknown as HTMLElement);
  await act(async () => root!.render(<WebDataTableHeader
    columns={[{ id: "name", label: "Name", width: 12 }]}
    columnGap={1} horizontalPadding={1} focusPane={() => {}}
    gridTemplateColumns="100px" sortColumnId={null} sortDirection="asc"
    onHeaderClick={() => sorted++}
    onColumnResize={(_, width) => resized.push(width)}
    onColumnResizeEnd={() => ended++} onColumnResizeReset={() => reset++}
  />));
  const handle = container.querySelector('[role="separator"]')!;
  if (handle) handle.parentElement!.getBoundingClientRect = () => ({ width: 12 * WEB_CELL_WIDTH }) as DOMRect;
  return { handle, resized, counts: () => ({ ended, reset, sorted }) };
}

test("keyboard resizing and reset do not sort the column", async () => {
  const probe = await mount();
  expect(probe.handle).not.toBeNull();
  for (const key of ["ArrowRight", "ArrowLeft", "Home"]) {
    await act(async () => {
      probe.handle.dispatchEvent(new testWindow.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
    await act(async () => {
      probe.handle.dispatchEvent(new testWindow.KeyboardEvent("keyup", { key, bubbles: true }));
    });
  }
  expect(probe.resized).toEqual([13, 11]);
  expect(probe.counts()).toEqual({ ended: 2, reset: 1, sorted: 0 });
});

test("touch and pen pointer sessions ignore other pointers and clean up on cancellation", async () => {
  const probe = await mount();
  expect(probe.handle).not.toBeNull();
  for (const pointerType of ["touch", "pen"]) {
    await act(async () => {
      probe.handle.dispatchEvent(new testWindow.PointerEvent("pointerdown", {
        pointerType, pointerId: 7, isPrimary: true, button: 0, clientX: 20, bubbles: true,
      }));
      testWindow.document.dispatchEvent(new testWindow.PointerEvent("pointermove", { pointerId: 8, clientX: 200 }));
      testWindow.document.dispatchEvent(new testWindow.PointerEvent("pointermove", { pointerId: 7, clientX: 20 + 3 * WEB_CELL_WIDTH }));
      testWindow.document.dispatchEvent(new testWindow.PointerEvent("pointercancel", { pointerId: 7 }));
      testWindow.document.dispatchEvent(new testWindow.PointerEvent("pointermove", { pointerId: 7, clientX: 200 }));
    });
  }
  expect(probe.resized).toEqual([15, 15]);
  expect(probe.counts()).toEqual({ ended: 2, reset: 0, sorted: 0 });
  expect(testWindow.document.body.classList.contains("gloom-col-resizing")).toBe(false);
});
