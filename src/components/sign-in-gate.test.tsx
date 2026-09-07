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
import { act } from "react";
import { createRoot } from "react-dom/client";
import { UiHostProvider, type RendererHost, type UiHost } from "../ui";
import { WebBox } from "../renderers/electrobun/view/host/box";
import { WebText, WebSpan } from "../renderers/electrobun/view/host/text";
import { WebScrollBox } from "../renderers/electrobun/view/host/scroll-box";
import { WebInput } from "../renderers/electrobun/view/host/input";
import { WebButton, WebTextField } from "../renderers/electrobun/view/desktop/controls";
import { WebInputHostProvider } from "../renderers/electrobun/view/input-host";
import { useShortcut } from "../react/input";
import { SignInGate } from "./sign-in-gate";

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
  ScrollBox: WebScrollBox,
  Button: WebButton,
  Input: WebInput,
  TextField: WebTextField,
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
});

/** Stands in for the app's own global shortcuts, which register unscoped. */
function AppShortcutSpy({ onKey }: { onKey: () => void }) {
  useShortcut(onKey, { phase: "before", allowEditable: true });
  return null;
}

async function renderGate(onAppKey: () => void): Promise<HTMLElement> {
  const container = testWindow.document.createElement("div");
  testWindow.document.body.appendChild(container);
  root = createRoot(container as unknown as HTMLElement);
  await act(async () => {
    root!.render(
      <UiHostProvider ui={ui} renderer={renderer}>
        <WebInputHostProvider>
          <AppShortcutSpy onKey={onAppKey} />
          <SignInGate />
        </WebInputHostProvider>
      </UiHostProvider>,
    );
  });
  return container as unknown as HTMLElement;
}

function pressKey(key: string, target?: Element): void {
  const event = new testWindow.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  (target ?? testWindow.document.body).dispatchEvent(event);
}

test("holds every app shortcut while the gate is up", async () => {
  let appKeys = 0;
  await renderGate(() => { appKeys += 1; });

  await act(async () => {
    for (const key of ["k", "Tab", "1", "?", "q", "`"]) pressKey(key);
  });

  expect(appKeys).toBe(0);
});

test("still delivers typing to the gate's own fields", async () => {
  let appKeys = 0;
  const container = await renderGate(() => { appKeys += 1; });

  const email = container.querySelector('input[type="email"]') as HTMLInputElement | null;
  expect(email).not.toBeNull();

  await act(async () => {
    email!.value = "trader@example.com";
    email!.dispatchEvent(new testWindow.Event("input", { bubbles: true }) as unknown as Event);
    pressKey("t", email!);
  });

  // The hold sits on the window listener, which fires after the field already
  // took the key, so the value survives while the app still sees nothing.
  expect(email!.value).toBe("trader@example.com");
  expect(appKeys).toBe(0);
});
