/** @jsxImportSource react */
import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ContextMenuProvider, useContextMenu } from "./context-menu";
import { UiHostProvider, type UiHost } from "./host";
import type { RendererHost } from "./host";
import { contextMenuDivider, type ContextMenuItem } from "../types/context-menu";

const testWindow = new Window({ url: "http://localhost" });
Object.assign(globalThis, {
  window: testWindow,
  document: testWindow.document,
  IS_REACT_ACT_ENVIRONMENT: true,
});
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  testWindow.document.body.innerHTML = "";
});

const testUiHost = { kind: "desktop-web" } as unknown as UiHost;
const testRendererHost = {
  showContextMenu: undefined,
  copyText: async () => {},
  openExternal: async () => {},
} as unknown as RendererHost;

function Trigger({ onTrigger }: { onTrigger: (items: ContextMenuItem[]) => Promise<boolean> }) {
  const { showContextMenu } = useContextMenu();
  return (
    <div
      onContextMenu={(event: any) => {
        event.preventDefault();
        void showContextMenu(
          { kind: "link", url: "https://example.com" },
          [
            { id: "open", label: "Open Link", onSelect: () => onTrigger([{ id: "open" }]) },
            contextMenuDivider("div"),
            { id: "copy", label: "Copy Link", onSelect: () => onTrigger([{ id: "copy" }]) },
          ],
          event,
        );
      }}
      data-testid="trigger"
    >
      trigger
    </div>
  );
}

async function mountTrigger(onTrigger: (items: ContextMenuItem[]) => Promise<boolean> | void) {
  const container = testWindow.document.createElement("div");
  testWindow.document.body.append(container);
  root = createRoot(container as unknown as HTMLElement);
  await act(async () => root!.render(
    <UiHostProvider ui={testUiHost} renderer={testRendererHost} nativeRenderer={undefined}>
      <ContextMenuProvider pluginRegistry={null}>
        <Trigger onTrigger={async (items) => { onTrigger(items); return true; }} />
      </ContextMenuProvider>
    </UiHostProvider>,
  ));
}

async function openMenu(): Promise<void> {
  await act(async () => {
    testWindow.document.querySelector("[data-testid='trigger']")?.dispatchEvent(
      new testWindow.MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 120,
        clientY: 80,
      }),
    );
  });
}

describe("DOM fallback context menu", () => {
  test("renders translated items after right-click and runs the chosen action", async () => {
    const chosen: Array<{ id: string }> = [];
    await mountTrigger((items) => { chosen.push(...items); });
    await openMenu();

    const menu = testWindow.document.querySelector("[role='menu'][data-gloom-role='context-menu-fallback']");
    expect(menu).not.toBeNull();
    const rows = Array.from(menu!.querySelectorAll("[role='menuitem']"));
    const labels = rows.map((row) => row.textContent);
    expect(labels).toContain("Open Link");
    expect(labels).toContain("Copy Link");

    const openRow = rows.find((row) => row.textContent === "Open Link");
    await act(async () => {
      openRow?.dispatchEvent(new testWindow.MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(chosen).toEqual([{ id: "open" }]);
    expect(testWindow.document.querySelector("[data-gloom-role='context-menu-fallback']")).toBeNull();
  });

  test("closes on Escape targeted at the open menu", async () => {
    await mountTrigger(() => {});
    await openMenu();
    expect(testWindow.document.querySelector("[data-gloom-role='context-menu-fallback']")).not.toBeNull();

    await act(async () => {
      const container = testWindow.document.querySelector("[data-gloom-role='context-menu-fallback']");
      container?.dispatchEvent(new testWindow.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }));
    });
    expect(testWindow.document.querySelector("[data-gloom-role='context-menu-fallback']")).toBeNull();
  });

  test("closes when clicking outside the menu", async () => {
    await mountTrigger(() => {});
    await openMenu();
    expect(testWindow.document.querySelector("[data-gloom-role='context-menu-fallback']")).not.toBeNull();

    await act(async () => {
      testWindow.document.body.dispatchEvent(new testWindow.PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
      }));
    });
    expect(testWindow.document.querySelector("[data-gloom-role='context-menu-fallback']")).toBeNull();
  });

  test("expands submenu items and runs the nested action", async () => {
    const chosen: Array<{ id: string }> = [];
    const container = testWindow.document.createElement("div");
    testWindow.document.body.append(container);
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => root!.render(
      <UiHostProvider ui={testUiHost} renderer={testRendererHost} nativeRenderer={undefined}>
        <ContextMenuProvider pluginRegistry={null}>
          <SubmenuTrigger onSelect={() => chosen.push({ id: "watchlist" })} />
        </ContextMenuProvider>
      </UiHostProvider>,
    ));
    testWindow.document.querySelector("[data-testid='sub-trigger']")?.dispatchEvent(
      new testWindow.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 60, clientY: 40 }),
    );
    await act(async () => {});

    const addTo = Array.from(testWindow.document.querySelectorAll("[role='menuitem']"))
      .find((row) => row.textContent?.includes("Add to..."));
    expect(addTo).toBeDefined();
    addTo!.dispatchEvent(new testWindow.MouseEvent("click", { bubbles: true, cancelable: true }));
    await act(async () => {});
    const watchlist = Array.from(testWindow.document.querySelectorAll("[role='menuitem']"))
      .find((row) => row.textContent === "Watchlist...");
    expect(watchlist).toBeDefined();
    watchlist!.dispatchEvent(new testWindow.MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(chosen).toEqual([{ id: "watchlist" }]);
  });
});

function SubmenuTrigger({ onSelect }: { onSelect: () => void }) {
  const { showContextMenu } = useContextMenu();
  return (
    <div
      data-testid="sub-trigger"
      onContextMenu={(event: any) => {
        event.preventDefault();
        void showContextMenu(
          { kind: "app" },
          [
            {
              id: "add-to",
              label: "Add to...",
              submenu: [
                { id: "watchlist", label: "Watchlist...", onSelect },
                { id: "portfolio", label: "Portfolio...", onSelect },
              ],
            },
          ],
          event,
        );
      }}
    >
      sub
    </div>
  );
}
