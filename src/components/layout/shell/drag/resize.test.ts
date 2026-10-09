import { expect, test } from "bun:test";
import { resolveFloatResizeRect } from "./index";

const drag = {
  startX: 100,
  startY: 80,
  origRect: { x: 40, y: 30, width: 80, height: 40, zIndex: 1 },
};

test("each corner moves the edges it owns", () => {
  expect(resolveFloatResizeRect({ ...drag, corner: "bottom-right" }, 110, 90, 400, 300))
    .toMatchObject({ x: 40, y: 30, width: 90, height: 50 });
  expect(resolveFloatResizeRect({ ...drag, corner: "top-left" }, 90, 70, 400, 300))
    .toMatchObject({ x: 30, y: 20, width: 90, height: 50 });
  expect(resolveFloatResizeRect({ ...drag, corner: "top-right" }, 120, 70, 400, 300))
    .toMatchObject({ x: 40, y: 20, width: 100, height: 50 });
  expect(resolveFloatResizeRect({ ...drag, corner: "bottom-left" }, 90, 100, 400, 300))
    .toMatchObject({ x: 30, y: 30, width: 90, height: 60 });
});
