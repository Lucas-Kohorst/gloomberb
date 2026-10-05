/** @jsxImportSource react */
import { Window } from "happy-dom";

const testWindow = new Window({ url: "http://localhost" });
const domGlobals = {
  IS_REACT_ACT_ENVIRONMENT: true,
  window: testWindow,
  document: testWindow.document,
  navigator: testWindow.navigator,
  KeyboardEvent: testWindow.KeyboardEvent,
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

import { afterAll, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useDialog, type DialogApi } from "../../../ui/dialog";
import { WebDialogHostProvider } from "./dialog-host";

afterAll(() => {
  for (const [key, value] of Object.entries(priorGlobals)) {
    if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
    else (globalThis as Record<string, unknown>)[key] = value;
  }
});

test("a modal dialog makes the workspace inert, keeps toasts live, and hands focus back", async () => {
  let dialog: DialogApi | null = null;
  function Workspace() {
    dialog = useDialog();
    return (
      <div data-testid="workspace">
        <button type="button" data-testid="opener">Open</button>
        <div className="gloom-toast-viewport" aria-live="polite" />
      </div>
    );
  }

  const container = testWindow.document.createElement("div");
  testWindow.document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);
  await act(async () => {
    root.render(<WebDialogHostProvider><Workspace /></WebDialogHostProvider>);
  });
  const opener = container.querySelector('[data-testid="opener"]') as unknown as HTMLElement;
  opener.focus();

  await act(async () => {
    void dialog!.prompt({ content: <input data-testid="field" /> });
  });
  // Let the dialog take focus on its next frame, as it does in the app.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  expect(testWindow.document.activeElement?.getAttribute("role")).toBe("dialog");
  const toasts = container.querySelector(".gloom-toast-viewport")!;
  // The workspace's own nodes go inert; the path down to the toasts does not.
  expect(opener.hasAttribute("inert")).toBe(true);
  expect(container.querySelector('[data-testid="workspace"]')?.hasAttribute("inert")).toBe(false);
  expect(toasts.hasAttribute("inert")).toBe(false);
  expect(container.querySelector(".gloom-dialog-backdrop")?.hasAttribute("inert")).toBe(false);

  await act(async () => {
    testWindow.dispatchEvent(new testWindow.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(container.querySelector(".gloom-dialog-backdrop")).toBeNull();
  expect(container.querySelectorAll("[inert]")).toHaveLength(0);
  expect(testWindow.document.activeElement).toBe(opener as never);

  await act(async () => root.unmount());
});
