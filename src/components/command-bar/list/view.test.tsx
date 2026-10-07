import { expect, test } from "bun:test";
import { createOpenTuiTestHarness } from "../../../renderers/opentui/test-utils";
import { createRemoteUiRegistry, RemoteUiRegistryProvider } from "../../../remote/semantic-tree";
import { commandBarResultsFromNodes } from "../../../remote/command-bar";
import { CommandBarListBody } from "./view";
import type { CommandBarListRow, ListScreenState, ResultItem } from "./model";

const tui = createOpenTuiTestHarness();

function item(overrides: Partial<ResultItem> & { id: string; label: string }): ResultItem {
  return {
    detail: "",
    category: "Commands",
    kind: "command",
    action: () => {},
    ...overrides,
  };
}

function rows(items: ResultItem[]): CommandBarListRow[] {
  return [
    { kind: "heading", id: "heading", label: "Commands" },
    ...items.map((entry, index) => ({ kind: "item" as const, item: entry, globalIdx: index })),
  ];
}

const LIST_STATE: ListScreenState = {
  kind: "root",
  title: "Commands",
  query: "port",
  selectedIdx: -1,
  hoveredIdx: null,
  results: [],
  searching: false,
  emptyLabel: "",
  emptyDetail: "",
  footerLeft: "",
  footerRight: "",
};

function ListHarness({ nativeListRows, selectedIdx = -1 }: { nativeListRows: CommandBarListRow[]; selectedIdx?: number }) {
  return (
    <CommandBarListBody
      visibleListState={{ ...LIST_STATE, selectedIdx }}
      nativeListRows={nativeListRows}
      listBodyHeight={16}
      contentPadding={3}
      labelWidth={40}
      nativePaneChrome={false}
      nativeListScrollRef={{ current: null }}
      paletteAccentText="#ffffff"
      paletteBg="#000000"
      paletteHeadingText="#ffffff"
      paletteHoverBg="#000000"
      paletteMatchText="#ffffff"
      paletteSelectedBg="#000000"
      paletteSelectedText="#ffffff"
      paletteSubtleText="#ffffff"
      paletteText="#ffffff"
      panelBg="#000000"
      queryDisplayWidth={50}
      trailingWidth={10}
      onHoverIndex={() => {}}
      onListScroll={() => {}}
      onRowMouseDown={() => {}}
    />
  );
}

function columnOf(frame: string, text: string): number {
  const line = frame.split("\n").find((row) => row.includes(text));
  return line ? line.indexOf(text) : -1;
}

/**
 * Instruments and documents arrive after the local rows and carry wider badges
 * than they do, so a column measured from what is on screen would widen
 * mid-query and drag every label already rendered to the right.
 */
test("keeps labels in place when a later section brings wider badges", async () => {
  const local = [
    item({ id: "portfolio", label: "Open Portfolio" }),
    item({ id: "quote", label: "Quote", right: "Q" }),
  ];

  await tui.render(<ListHarness nativeListRows={rows(local)} />, { width: 60, height: 20 });
  await tui.setup().renderOnce();
  const before = tui.frame();
  await tui.render(
    <ListHarness
      nativeListRows={rows([
        ...local,
        item({ id: "spy", label: "SPDR S&P 500", kind: "search", badge: "ETF" }),
        item({ id: "filing", label: "Annual report", kind: "action", badge: "10-K" }),
        item({ id: "derivative", label: "Call spread", kind: "search", badge: "DERIV" }),
      ])}
    />,
    { width: 60, height: 20 },
  );
  await tui.setup().renderOnce();
  const after = tui.frame();

  expect(columnOf(before, "Open Portfolio")).toBeGreaterThan(0);
  expect(columnOf(after, "Open Portfolio")).toBe(columnOf(before, "Open Portfolio"));
  expect(columnOf(after, "Commands")).toBe(columnOf(before, "Commands"));
  // The widest badge ends one gap short of the label edge it shares.
  expect(columnOf(after, "DERIV") + "DERIV".length).toBe(columnOf(after, "Call spread") - 1);
});

/**
 * A long terminal list draws only the rows near the selection, but remote
 * control lists and activates results by label or index across the whole list.
 */
test("remote control still sees every result of a long list", async () => {
  const registry = createRemoteUiRegistry();
  const items = Array.from({ length: 150 }, (_unused, index) => item({ id: `cmd-${index}`, label: `Command ${index}` }));
  await tui.render(
    <RemoteUiRegistryProvider registry={registry}>
      <ListHarness nativeListRows={rows(items)} selectedIdx={0} />
    </RemoteUiRegistryProvider>,
    { width: 60, height: 20 },
  );
  await tui.setup().renderOnce();

  expect(tui.frame()).not.toContain("Command 149");
  const results = commandBarResultsFromNodes(registry.snapshot());
  expect(results).toHaveLength(150);
  expect(results.at(-1)).toMatchObject({ label: "Command 149", index: 149, selected: false });
  expect(results[0]).toMatchObject({ selected: true });
});
