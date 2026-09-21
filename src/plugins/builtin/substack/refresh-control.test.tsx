/** @jsxImportSource react */
import { createTestRendererHost, createWebUiHost, installDomGlobals } from "../../../test-support/dom";

const testWindow = installDomGlobals();

import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { UiHostProvider } from "../../../ui";
import { SubstackRefreshControl, SUBSTACK_REFRESH_ROLE } from "./refresh-control";

const renderer = createTestRendererHost();
const baseUi = createWebUiHost();
const ui = {
  ...baseUi,
  capabilities: { ...baseUi.capabilities, nativePaneChrome: true },
};

let root: ReturnType<typeof createRoot> | undefined;

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
    root = undefined;
  }
  testWindow.document.body.innerHTML = "";
});

async function mountControl(onRefresh: () => void, loading = false) {
  const container = testWindow.document.createElement("div");
  testWindow.document.body.appendChild(container);
  root = createRoot(container as unknown as HTMLElement);
  await act(async () => {
    root!.render(
      <UiHostProvider ui={ui} renderer={renderer}>
        <SubstackRefreshControl onRefresh={onRefresh} loading={loading} />
      </UiHostProvider>,
    );
  });
  return container;
}

test("desktop refresh control is a real button that refetches on click", async () => {
  let clicks = 0;
  const container = await mountControl(() => {
    clicks += 1;
  });

  const button = container.querySelector(`[data-gloom-role="${SUBSTACK_REFRESH_ROLE}"]`) as HTMLButtonElement | null;
  expect(button).not.toBeNull();
  expect(button!.tagName).toBe("BUTTON");
  expect(button!.textContent).toContain("Refresh");
  expect(button!.disabled).toBe(false);

  await act(async () => {
    button!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  expect(clicks).toBe(1);
});

test("desktop refresh control stays inert while a reload is in flight", async () => {
  let clicks = 0;
  const container = await mountControl(() => {
    clicks += 1;
  }, true);

  const button = container.querySelector(`[data-gloom-role="${SUBSTACK_REFRESH_ROLE}"]`) as HTMLButtonElement | null;
  expect(button?.disabled).toBe(true);
  expect(button?.textContent).toContain("Refreshing");

  await act(async () => {
    button!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  expect(clicks).toBe(0);
});
