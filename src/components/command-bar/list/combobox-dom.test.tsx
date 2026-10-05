/** @jsxImportSource react */
import { Window } from "happy-dom";

const testWindow = new Window({ url: "http://localhost", width: 1200, height: 600 });
const domGlobals = {
  IS_REACT_ACT_ENVIRONMENT: true,
  window: testWindow,
  document: testWindow.document,
  navigator: testWindow.navigator,
  KeyboardEvent: testWindow.KeyboardEvent,
  MouseEvent: testWindow.MouseEvent,
  HTMLElement: testWindow.HTMLElement,
  Node: testWindow.Node,
  requestAnimationFrame: (callback: (time: number) => void) => setTimeout(() => callback(Date.now()), 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
};

/** Bun shares one process across test files, so the DOM globals must not leak. */
const priorGlobals = Object.fromEntries(
  Object.keys(domGlobals).map((key) => [key, (globalThis as Record<string, unknown>)[key]]),
);
Object.assign(globalThis, domGlobals);

import { afterAll, afterEach, expect, test } from "bun:test";
import { act, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { UiHostProvider, type RendererHost, type UiHost } from "../../../ui";
import { WebBox } from "../../../renderers/electrobun/view/host/box";
import { WebInput } from "../../../renderers/electrobun/view/host/input";
import { WebScrollBox } from "../../../renderers/electrobun/view/host/scroll-box";
import { WebSpan, WebText } from "../../../renderers/electrobun/view/host/text";
import { WebInputHostProvider } from "../../../renderers/electrobun/view/input-host";
import { AppContext, createInitialState } from "../../../state/app/context";
import { createDefaultConfig } from "../../../types/config";
import { Header } from "../../layout/header";
import { publishCommandBarPrompt } from "../panel/prompt-binding";
import type { CommandBarListRow, ListScreenState, ResultItem } from "./model";
import { COMMAND_BAR_LISTBOX_ID, CommandBarListBody, resolveCommandBarActiveOptionId } from "./view";

const renderer: RendererHost = {
  requestExit() {},
  async openExternal() {},
  async copyText() {},
  async readText() { return ""; },
  notify() {},
};

const ui = {
  kind: "desktop-web",
  capabilities: { cellWidthPx: 8, cellHeightPx: 18, fractionalViewport: true, nativePaneChrome: true },
  Box: WebBox,
  Text: WebText,
  Span: WebSpan,
  ScrollBox: WebScrollBox,
  Input: WebInput,
  SpinnerMark: () => null,
} as unknown as UiHost;

afterAll(() => {
  for (const [key, value] of Object.entries(priorGlobals)) {
    if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
    else (globalThis as Record<string, unknown>)[key] = value;
  }
});

let root: ReturnType<typeof createRoot> | undefined;

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
    root = undefined;
  }
  publishCommandBarPrompt(null);
  testWindow.document.body.innerHTML = "";
});

function item(id: string, label: string): ResultItem {
  return { id, label, detail: "", category: "Commands", kind: "command", action: () => {} };
}

const ROWS: CommandBarListRow[] = [
  { kind: "heading", id: "heading", label: "Commands" },
  { kind: "item", item: item("port", "Portfolio"), globalIdx: 0 },
  { kind: "item", item: item("news", "News"), globalIdx: 1 },
  { kind: "item", item: item("chat", "Chat"), globalIdx: 2 },
];

const LIST_STATE: ListScreenState = {
  kind: "root",
  title: "Commands",
  query: "",
  selectedIdx: 0,
  hoveredIdx: null,
  results: [],
  searching: false,
  emptyLabel: "",
  emptyDetail: "",
  footerLeft: "",
  footerRight: "",
};

let setSelectedIdx: (index: number) => void = () => {};

/** Stands in for the panel: the list and the binding it publishes share one selection. */
function CommandBarHarness() {
  const [selectedIdx, setSelected] = useState(0);
  setSelectedIdx = setSelected;
  useLayoutEffect(() => {
    publishCommandBarPrompt({
      screenKey: "root:Commands",
      query: "",
      placeholder: "Search or run a command",
      ghostSuffix: null,
      onQueryChange: () => {},
      listboxId: COMMAND_BAR_LISTBOX_ID,
      activeOptionId: resolveCommandBarActiveOptionId(ROWS, selectedIdx),
    });
  }, [selectedIdx]);
  return (
    <CommandBarListBody
      visibleListState={{ ...LIST_STATE, selectedIdx }}
      nativeListRows={ROWS}
      listBodyHeight={8}
      contentPadding={1}
      labelWidth={40}
      nativePaneChrome
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
      queryDisplayWidth={60}
      trailingWidth={0}
      onHoverIndex={() => {}}
      onListScroll={() => {}}
      onRowMouseDown={() => {}}
    />
  );
}

test("the command bar input is a combobox whose active descendant follows the selected row", async () => {
  const state = {
    ...createInitialState(createDefaultConfig("/tmp/gloomberb-combobox-test")),
    commandBarOpen: true,
  };
  const container = testWindow.document.createElement("div");
  testWindow.document.body.appendChild(container);
  root = createRoot(container as unknown as HTMLElement);
  await act(async () => {
    root!.render(
      <UiHostProvider ui={ui} renderer={renderer}>
        <WebInputHostProvider>
          <AppContext value={{ state, dispatch: () => {} }}>
            <Header />
            <CommandBarHarness />
          </AppContext>
        </WebInputHostProvider>
      </UiHostProvider>,
    );
  });

  const input = container.querySelector('input[role="combobox"]')!;
  expect(input).not.toBeNull();
  expect(input.getAttribute("aria-expanded")).toBe("true");
  const listbox = container.querySelector(`#${COMMAND_BAR_LISTBOX_ID}`)!;
  expect(input.getAttribute("aria-controls")).toBe(COMMAND_BAR_LISTBOX_ID);
  expect(listbox.getAttribute("role")).toBe("listbox");

  const activeOption = () => {
    const id = input.getAttribute("aria-activedescendant");
    return id ? listbox.querySelector(`#${id}`) : null;
  };
  expect(activeOption()?.textContent).toContain("Portfolio");
  expect(activeOption()?.getAttribute("aria-selected")).toBe("true");

  await act(async () => setSelectedIdx(2));
  expect(activeOption()?.textContent).toContain("Chat");
  expect(activeOption()?.getAttribute("role")).toBe("option");
  const selected = [...listbox.querySelectorAll('[role="option"][aria-selected="true"]')];
  expect(selected).toHaveLength(1);
  // Options are driven from the input; they must not become tab stops.
  expect(listbox.querySelectorAll('[role="option"][tabindex]')).toHaveLength(0);
});
