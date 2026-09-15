/** @jsxImportSource react */
import { Window } from "happy-dom";

// Markdown links only become clickable on the hosts that have a real DOM, so
// the open path has to be exercised against one.
const testWindow = new Window({ url: "http://localhost" });
const replaced: Array<[string, PropertyDescriptor | undefined]> = [];

function installGlobal(name: string, value: unknown): void {
  replaced.push([name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

// Only what react-dom needs to mount, and restored in afterAll. Publishing
// happy-dom's Event or MouseEvent globally breaks suites that dispatch native
// events at native EventTargets, so those stay reachable through testWindow.
installGlobal("window", testWindow);
installGlobal("document", testWindow.document);
installGlobal("IS_REACT_ACT_ENVIRONMENT", true);

import { afterAll, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MarkdownText } from "./markdown-text";
import { UiHostProvider, type RendererHost, type UiHost } from "../ui";
import { WebBox } from "../renderers/electrobun/view/host/box";
import { WebSpan, WebText } from "../renderers/electrobun/view/host/text";

afterAll(() => {
  for (const [name, descriptor] of replaced.reverse()) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

const webUiHost = {
  kind: "desktop-web",
  capabilities: { nativeContextMenu: false },
  Box: WebBox,
  Text: WebText,
  Span: WebSpan,
} as unknown as UiHost;

test("a markdown link opens its href, not its label, when clicked", async () => {
  const opened: string[] = [];
  const rendererHost = {
    openExternal: async (url: string) => { opened.push(url); },
    copyText: async () => {},
  } as unknown as RendererHost;

  const container = testWindow.document.createElement("div");
  testWindow.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  await act(async () => {
    root.render(
      <UiHostProvider ui={webUiHost} renderer={rendererHost}>
        <MarkdownText text="Read the [filing](https://sec.gov/x) today." selectable />
      </UiHostProvider>,
    );
  });

  const link = container.querySelector('[data-gloom-interactive="true"]') as unknown as HTMLElement;
  expect(link).not.toBeNull();
  expect(link.textContent).toBe("filing");
  // The cursor and the tooltip both come off the element, so the href has to
  // reach it rather than only the click handler's closure.
  expect(link.getAttribute("title")).toBe("https://sec.gov/x");
  // The stylesheet keys selection off this exact attribute, so a rename here
  // silently leaves reader text uncopyable.
  expect(container.querySelector('[data-gloom-text-selectable="true"]')).not.toBeNull();

  await act(async () => {
    link.dispatchEvent(new testWindow.MouseEvent("mousedown", { bubbles: true, button: 0 }) as never);
  });
  expect(opened).toEqual(["https://sec.gov/x"]);

  await act(async () => root.unmount());
});
