/** @jsxImportSource react */
import { installDomGlobals } from "../../test-support/dom";

const testWindow = installDomGlobals();

import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  createShortcutRegistry,
  InputHostProvider,
  useRegisteredShortcut,
  type InputHost,
  type KeyEventLike,
} from "../../react/input";
import { useMarketplaceListNavigation } from "./sidebar";

let root: ReturnType<typeof createRoot> | undefined;

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
    root = undefined;
  }
});

function keyEvent(name: string, overrides: Partial<KeyEventLike> = {}): KeyEventLike {
  let defaultPrevented = false;
  let propagationStopped = false;
  return {
    key: name,
    name,
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
    get defaultPrevented() { return defaultPrevented; },
    get propagationStopped() { return propagationStopped; },
    preventDefault: () => { defaultPrevented = true; },
    stopPropagation: () => { propagationStopped = true; },
    ...overrides,
  };
}

const ITEMS = [{ id: "a" }, { id: "b" }, { id: "c" }];

async function mountNavigation(selectedId: string | null) {
  const registry = createShortcutRegistry();
  const host: InputHost = {
    useShortcut: (handler, options) => useRegisteredShortcut(registry, handler, options),
    useViewport: () => ({ width: 80, height: 24 }),
  };
  const selections: string[] = [];
  function Harness() {
    useMarketplaceListNavigation({
      enabled: true,
      scope: "test-gallery",
      items: ITEMS,
      selectedId,
      select: (id) => selections.push(id),
    });
    return null;
  }
  const container = testWindow.document.createElement("div");
  root = createRoot(container as unknown as HTMLElement);
  await act(async () => {
    root!.render(<InputHostProvider host={host}><Harness /></InputHostProvider>);
  });
  return { dispatch: (event: KeyEventLike) => registry.dispatch(event), selections };
}

test("arrows step in rendered order and clamp at the ends", async () => {
  const { dispatch, selections } = await mountNavigation("c");

  dispatch(keyEvent("up"));
  dispatch(keyEvent("down"));
  dispatch(keyEvent("down"));
  expect(selections).toEqual(["b", "c", "c"]);
});

test("j and k navigate only outside the search field; arrows always do", async () => {
  const { dispatch, selections } = await mountNavigation("b");

  dispatch(keyEvent("j", { targetEditable: true }));
  dispatch(keyEvent("k", { targetEditable: true }));
  expect(selections).toEqual([]);

  dispatch(keyEvent("down", { targetEditable: true }));
  dispatch(keyEvent("j"));
  expect(selections).toEqual(["c", "c"]);
});

test("modified arrows are left to the host", async () => {
  const { dispatch, selections } = await mountNavigation("b");
  const event = keyEvent("down", { meta: true });

  dispatch(event);
  expect(selections).toEqual([]);
  expect(event.defaultPrevented).toBe(false);
});
