/** @jsxImportSource react */
import { Window } from "happy-dom";

const testWindow = new Window({ url: "http://localhost" });
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  window: testWindow,
  document: testWindow.document,
  navigator: testWindow.navigator,
  HTMLElement: testWindow.HTMLElement,
  MouseEvent: testWindow.MouseEvent,
});

import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useToastHost, type ToastHost } from "../../../ui/toast";
import { WebToastHostProvider } from "./toast-host";

let toastHost: ToastHost | null = null;

function ToastViewport() {
  const host = useToastHost();
  toastHost = host;
  const Viewport = host.Viewport;
  return <Viewport />;
}

async function mountViewport() {
  const container = testWindow.document.createElement("div");
  testWindow.document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);
  await act(async () => {
    root.render(
      <WebToastHostProvider>
        <ToastViewport />
      </WebToastHostProvider>,
    );
  });
  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
      toastHost = null;
    },
  };
}

async function click(element: EventTarget) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

test("announces toast content and only acts on click when an action is attached", async () => {
  const { container, unmount } = await mountViewport();
  let opened = 0;

  try {
    const viewport = container.querySelector(".gloom-toast-viewport") as unknown as HTMLElement;
    expect(viewport.getAttribute("aria-live")).toBe("polite");

    await act(async () => {
      toastHost?.info("@bob mentioned you", {
        title: "Gloomberb chat",
        subtitle: "#everyone",
        duration: 0,
        action: { label: "Open", onClick: () => opened++ },
      });
    });
    const toast = container.querySelector(".gloom-toast") as unknown as HTMLElement;
    expect(toast.textContent).toContain("Gloomberb chat");
    expect(toast.textContent).toContain("#everyone");

    await click(toast);
    expect(opened).toBe(1);
    expect(container.querySelector(".gloom-toast")).toBeNull();

    // A toast without an action must not respond to whole-card clicks.
    await act(async () => {
      toastHost?.info("Saved", { duration: 0 });
    });
    const inert = container.querySelector(".gloom-toast") as unknown as HTMLElement;
    await click(inert);
    expect(opened).toBe(1);
    expect(container.querySelector(".gloom-toast")).not.toBeNull();
  } finally {
    await unmount();
  }
});

test("dismiss never fires the action, and the action button opens and closes", async () => {
  const { container, unmount } = await mountViewport();
  let opened = 0;

  try {
    await act(async () => {
      toastHost?.info("First toast", {
        duration: 0,
        action: { label: "Open", onClick: () => opened++ },
      });
    });
    const dismiss = container.querySelector(".gloom-toast-dismiss") as unknown as HTMLElement;
    await click(dismiss);
    expect(opened).toBe(0);
    expect(container.querySelector(".gloom-toast")).toBeNull();

    await act(async () => {
      toastHost?.info("Second toast", {
        duration: 0,
        action: { label: "Open", onClick: () => opened++ },
      });
    });
    const actionButton = container.querySelector(".gloom-toast-action") as unknown as HTMLElement;
    await click(actionButton);
    expect(opened).toBe(1);
    expect(container.querySelector(".gloom-toast")).toBeNull();
  } finally {
    await unmount();
  }
});
