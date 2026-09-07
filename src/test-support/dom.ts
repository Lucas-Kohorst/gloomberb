/**
 * Shared happy-dom harness for desktop/web tests.
 *
 * Bun runs every test file in one process, so DOM globals installed for a
 * desktop-view test would otherwise leak into files that load later. Call
 * `installDomGlobals()` at module top (before importing components under
 * test); it snapshots the previous values and restores them in an `afterAll`.
 *
 * `createWebUiHost()` returns the real Electrobun web host components cast to
 * the desktop-web `UiHost`, so tests exercise the production render path
 * instead of per-file hand-rolled fakes.
 */
import { afterAll } from "bun:test";
import { Window } from "happy-dom";
import type { RendererHost, UiHost } from "../ui";
import { WebBox } from "../renderers/electrobun/view/host/box";
import { WebText, WebSpan } from "../renderers/electrobun/view/host/text";
import { WebScrollBox } from "../renderers/electrobun/view/host/scroll-box";
import { WebInput } from "../renderers/electrobun/view/host/input";
import { WebButton, WebTextField } from "../renderers/electrobun/view/desktop/controls";

const DOM_GLOBAL_KEYS = [
  "IS_REACT_ACT_ENVIRONMENT",
  "window",
  "document",
  "navigator",
  "KeyboardEvent",
  "MouseEvent",
  "HTMLElement",
  "Node",
  "DOMParser",
  "requestAnimationFrame",
  "cancelAnimationFrame",
] as const;

export function installDomGlobals(url = "http://localhost"): Window {
  const testWindow = new Window({ url });
  const domGlobals: Record<string, unknown> = {
    IS_REACT_ACT_ENVIRONMENT: true,
    window: testWindow,
    document: testWindow.document,
    navigator: testWindow.navigator,
    KeyboardEvent: testWindow.KeyboardEvent,
    MouseEvent: testWindow.MouseEvent,
    HTMLElement: testWindow.HTMLElement,
    Node: testWindow.Node,
    DOMParser: testWindow.DOMParser,
    requestAnimationFrame: testWindow.requestAnimationFrame.bind(testWindow),
    cancelAnimationFrame: testWindow.cancelAnimationFrame.bind(testWindow),
  };
  const target = globalThis as Record<string, unknown>;
  const priorGlobals = Object.fromEntries(DOM_GLOBAL_KEYS.map((key) => [key, target[key]]));
  Object.assign(target, domGlobals);
  afterAll(() => {
    for (const key of DOM_GLOBAL_KEYS) {
      const value = priorGlobals[key];
      if (value === undefined) delete target[key];
      else target[key] = value;
    }
  });
  return testWindow;
}

export function createWebUiHost(): UiHost {
  return {
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
}

export function createTestRendererHost(): RendererHost {
  return {
    requestExit() {},
    async openExternal() {},
    async copyText() {},
    async readText() {
      return "";
    },
    notify() {},
  };
}
