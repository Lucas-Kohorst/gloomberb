import { describe, expect, test } from "bun:test";
import {
  buildListRows,
  getListRowsHeight,
  resolveListPageTarget,
  resolveListRowWindow,
  resolveSelectedScrollLine,
  type CommandBarListRow,
  type ListScreenState,
  type ResultItem,
} from "./model";

function makeItem(id: string, category: string, lineCount = 0): ResultItem {
  return {
    id,
    label: id,
    detail: "",
    category,
    kind: "action",
    lines: lineCount > 0
      ? Array.from({ length: lineCount }, (_unused, index) => ({
        segments: [{ text: `${id} line ${index}` }],
      }))
      : undefined,
    action: () => {},
  };
}

function makeListState(results: ResultItem[], selectedIdx = 0): ListScreenState {
  return {
    kind: "root",
    title: "Commands",
    query: "margin",
    selectedIdx,
    hoveredIdx: null,
    results,
    searching: false,
    emptyLabel: "",
    emptyDetail: "",
    footerLeft: "",
    footerRight: "",
  };
}

/** The clamp `CommandBarPanel` applies to the scroll box on every selection. */
function applyScroll(scrollTop: number, target: number, viewportHeight: number): number {
  if (target < 0) return scrollTop;
  if (target < scrollTop) return target;
  if (target >= scrollTop + viewportHeight) return target - viewportHeight + 1;
  return scrollTop;
}

function rowLineRange(
  rows: ReturnType<typeof buildListRows>,
  rowIndex: number,
): { first: number; last: number } {
  const first = resolveSelectedScrollLine(rows, rowIndex, false);
  return { first, last: resolveSelectedScrollLine(rows, rowIndex, true) };
}

describe("variable-height list rows", () => {
  test("counts a capped number of extra lines toward the list height", () => {
    const rows = buildListRows(makeListState([
      makeItem("plain", "Commands"),
      makeItem("snippet", "Documents", 1),
      makeItem("overflowing", "Documents", 5),
    ]));

    // Two headings and one spacer, a plain row, a two-line row, a capped
    // three-line row.
    expect(getListRowsHeight(rows)).toBe(3 + 1 + 2 + 3);
  });

  test("keeps the whole selected row inside a short viewport in both directions", () => {
    const results = [
      makeItem("a", "Documents", 2),
      makeItem("b", "Documents", 2),
      makeItem("c", "Documents", 2),
      makeItem("d", "Documents", 2),
    ];
    const rows = buildListRows(makeListState(results));
    const viewportHeight = 6;
    const itemRowIndexes = rows.flatMap((row, index) => (row.kind === "item" ? [index] : []));

    let scrollTop = 0;
    for (const rowIndex of itemRowIndexes) {
      const { first, last } = rowLineRange(rows, rowIndex);
      scrollTop = applyScroll(scrollTop, last, viewportHeight);
      expect(first).toBeGreaterThanOrEqual(scrollTop);
      expect(last).toBeLessThan(scrollTop + viewportHeight);
    }

    for (const rowIndex of [...itemRowIndexes].reverse()) {
      const { first, last } = rowLineRange(rows, rowIndex);
      scrollTop = applyScroll(scrollTop, first, viewportHeight);
      expect(first).toBeGreaterThanOrEqual(scrollTop);
      expect(last).toBeLessThan(scrollTop + viewportHeight);
    }
  });

  test("resolves no scroll target when the selection is not on a rendered row", () => {
    const rows = buildListRows(makeListState([makeItem("only", "Documents", 1)]));
    expect(resolveSelectedScrollLine(rows, -1, false)).toBe(-1);
    expect(resolveSelectedScrollLine(rows, rows.length, true)).toBe(-1);
  });
});

describe("page keys", () => {
  // Lines: heading, a, b, c, spacer, heading, d (3 lines), e.
  const rows = buildListRows(makeListState([
    makeItem("a", "Commands"),
    makeItem("b", "Commands"),
    makeItem("c", "Commands"),
    makeItem("d", "Documents", 2),
    makeItem("e", "Documents"),
  ]));

  test("pages by lines, so headings and snippets shorten a page", () => {
    // A 5-line viewport pages 4 lines: b, c, spacer, heading, and d would
    // overrun it, so the page stops on c.
    expect(resolveListPageTarget(rows, 0, 5, 1)).toBe(2);
    expect(resolveListPageTarget(rows, 4, 5, -1)).toBe(3);
    expect(resolveListPageTarget(rows, 2, 20, 1)).toBe(4);
    expect(resolveListPageTarget(rows, 4, 20, -1)).toBe(0);
  });

  test("moves at least one result even when the next row is taller than the page", () => {
    expect(resolveListPageTarget(rows, 2, 2, 1)).toBe(3);
    expect(resolveListPageTarget(rows, 0, 1, -1)).toBe(0);
  });
});

function mountedItems(window: ReturnType<typeof resolveListRowWindow>): number[] {
  return window.runs.flatMap((run) => run.rows.flatMap((row) => (row.kind === "item" ? [row.globalIdx] : [])));
}

function mountedLines(window: ReturnType<typeof resolveListRowWindow>): number {
  return window.runs.reduce((total, run) => total + run.padBefore + getListRowsHeight(run.rows), window.padAfter);
}

describe("list row window", () => {
  const longRows = (count: number, selectedIdx: number) => buildListRows(makeListState(
    Array.from({ length: count }, (_unused, index) => makeItem(`item-${index}`, "Commands")),
    selectedIdx,
  ));

  test("mounts a list that fits whole", () => {
    const rows = buildListRows(makeListState([makeItem("a", "Commands"), makeItem("b", "Commands", 2)]));
    const window = resolveListRowWindow(rows, 1, 16, 8);
    expect(window.runs).toEqual([{ padBefore: 0, rows }]);
    expect(window.padAfter).toBe(0);
  });

  test("mounts every line the scroll can land on when it follows the selection, in steady steps", () => {
    const rows = longRows(200, 100);
    const viewport = 16;
    const window = resolveListRowWindow(rows, 100, viewport, 8, 90);
    const items = mountedItems(window);
    // The selected row sits on line 101 (after the heading); a viewport either way of it is mounted.
    expect(items[0]).toBeLessThanOrEqual(100 - (viewport - 1) - 1);
    expect(items.at(-1)).toBeGreaterThanOrEqual(100 + (viewport - 1));
    expect(items.length).toBeLessThan(rows.length / 2);
    expect(mountedLines(window)).toBe(getListRowsHeight(rows));
    // One row further down the same rows stay mounted, so nothing remounts per keypress.
    expect(mountedItems(resolveListRowWindow(rows, 101, viewport, 8, 91))).toEqual(items);
  });

  test("a jump to the end mounts the end and the lines still on screen, not everything between", () => {
    const rows = longRows(400, 399);
    const window = resolveListRowWindow(rows, 399, 16, 8, 0);
    expect(window.runs).toHaveLength(2);
    expect(window.runs[0]!.padBefore).toBe(0);
    expect(mountedItems(window)).toContain(399);
    expect(mountedItems(window)).toContain(0);
    expect(mountedItems(window).length).toBeLessThan(150);
    expect(mountedLines(window)).toBe(getListRowsHeight(rows));
  });

  test("mounts a multi-line row whole when an edge falls inside it", () => {
    const rows = buildListRows(makeListState([
      ...Array.from({ length: 30 }, (_unused, index) => makeItem(`before-${index}`, "Commands")),
      makeItem("tall", "Commands", 2),
      ...Array.from({ length: 60 }, (_unused, index) => makeItem(`after-${index}`, "Commands")),
    ], 57));
    // The tall row covers lines 31 to 33 and the mounted lines start on line 32.
    const window = resolveListRowWindow(rows, 57, 10, 0);
    expect(window.runs[0]!.padBefore).toBe(31);
    expect(window.runs[0]!.rows[0]).toMatchObject({ kind: "item", item: { id: "tall" } });
    expect(mountedLines(window)).toBe(getListRowsHeight(rows));
  });
});
