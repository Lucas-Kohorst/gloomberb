/** @jsxImportSource react */
import { Window } from "happy-dom";

const testWindow = new Window({ url: "http://localhost" });
const domGlobals = {
  IS_REACT_ACT_ENVIRONMENT: true,
  window: testWindow,
  document: testWindow.document,
  navigator: testWindow.navigator,
  KeyboardEvent: testWindow.KeyboardEvent,
  MouseEvent: testWindow.MouseEvent,
  HTMLElement: testWindow.HTMLElement,
  Node: testWindow.Node,
};

/** Bun shares one process across test files, so the DOM globals must not leak. */
const priorGlobals = Object.fromEntries(
  Object.keys(domGlobals).map((key) => [key, (globalThis as Record<string, unknown>)[key]]),
);
Object.assign(globalThis, domGlobals);

import { afterAll, afterEach, expect, test } from "bun:test";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { UiHostProvider, type RendererHost, type UiHost } from "../../../../ui";
import { Button } from "../../../../components/ui/button";
import { WebButton } from "../desktop/controls";
import { WebBox } from "./box";
import { WebSpan, WebText } from "./text";

const renderer: RendererHost = {
  requestExit() {},
  async openExternal() {},
  async copyText() {},
  async readText() { return ""; },
  notify() {},
};

const ui = {
  kind: "desktop-web",
  capabilities: { cellWidthPx: 8, cellHeightPx: 18, fractionalViewport: true },
  Box: WebBox,
  Text: WebText,
  Span: WebSpan,
  Button: WebButton,
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
  testWindow.document.body.innerHTML = "";
});

async function render(node: ReactNode): Promise<HTMLElement> {
  const container = testWindow.document.createElement("div");
  testWindow.document.body.appendChild(container);
  root = createRoot(container as unknown as HTMLElement);
  await act(async () => {
    root!.render(<UiHostProvider ui={ui} renderer={renderer}>{node}</UiHostProvider>);
  });
  return container as unknown as HTMLElement;
}

function key(target: EventTarget, name: string): boolean {
  const event = new testWindow.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
  target.dispatchEvent(event as unknown as Event);
  return event.defaultPrevented;
}

function mouse(target: EventTarget, type: string, detail = 1) {
  target.dispatchEvent(new testWindow.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, detail }) as unknown as Event);
}

test("the shared Button is a real, named button that presses once per activation", async () => {
  const presses: string[] = [];
  const container = await render(
    <Button label="Save" shortcut="Enter" onPress={() => presses.push("save")} />,
  );
  const button = container.querySelector("button")!;
  expect(button.getAttribute("type")).toBe("button");
  expect(button.getAttribute("aria-label")).toBe("Save");

  // A pointer presses on mousedown; the click that follows must not press again.
  await act(async () => {
    mouse(button, "mousedown");
    mouse(button, "mouseup");
    mouse(button, "click", 1);
  });
  expect(presses).toEqual(["save"]);

  // Enter and Space on a focused button reach it as a click with no pointer detail.
  await act(async () => mouse(button, "click", 0));
  expect(presses).toEqual(["save", "save"]);
});

test("a disabled Button announces itself and never presses", async () => {
  const presses: string[] = [];
  const container = await render(<Button label="Save" disabled onPress={() => presses.push("save")} />);
  const button = container.querySelector("button")!;
  expect(button.getAttribute("aria-disabled")).toBe("true");
  await act(async () => {
    mouse(button, "mousedown");
    mouse(button, "click", 0);
  });
  expect(presses).toEqual([]);
});

test("interactive boxes take Enter/Space only when the keyboard put focus there", async () => {
  const presses: string[] = [];
  const appKeys: string[] = [];
  const container = await render(
    <WebBox>
      <WebBox data-gloom-interactive="true" data-testid="row" onMouseDown={() => presses.push("row")}>
        <WebText>Row</WebText>
      </WebBox>
      <WebBox data-gloom-interactive="true" data-testid="handle" onMouseDown={() => {}} onMouseDrag={() => {}} />
      <WebBox data-gloom-interactive="true" data-testid="radio" role="radio" onMouseDown={() => {}} />
    </WebBox>,
  );
  testWindow.addEventListener("keydown", (event) => appKeys.push((event as unknown as KeyboardEvent).key));
  const row = container.querySelector('[data-testid="row"]') as HTMLElement;
  expect(row.getAttribute("role")).toBe("button");
  expect(row.getAttribute("tabindex")).toBe("0");
  // Drag surfaces and boxes with their own role keep their semantics.
  expect(container.querySelector('[data-testid="handle"]')?.getAttribute("role")).toBeNull();
  expect(container.querySelector('[data-testid="radio"]')?.getAttribute("role")).toBe("radio");

  await act(async () => {
    key(testWindow.document, "Tab");
    row.focus();
  });
  let consumed = false;
  await act(async () => {
    consumed = key(row, "Enter");
  });
  expect(consumed).toBe(true);
  expect(presses).toEqual(["row"]);
  await act(async () => {
    key(row, " ");
  });
  expect(presses).toEqual(["row", "row"]);
  expect(appKeys).not.toContain("Enter");

  // Clicked into focus, Enter belongs to the app's shortcuts as it did before
  // these boxes were focusable.
  await act(async () => {
    row.blur();
    mouse(row, "mousedown");
    row.focus();
  });
  presses.length = 0;
  await act(async () => {
    consumed = key(row, "Enter");
  });
  expect(consumed).toBe(false);
  expect(presses).toEqual([]);
  expect(appKeys).toContain("Enter");
});
