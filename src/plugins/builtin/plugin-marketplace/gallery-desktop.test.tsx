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
import { UiHostProvider, type RendererHost, type UiHost } from "../../../ui";
import { WebBox } from "../../../renderers/electrobun/view/host/box";
import { WebText, WebSpan } from "../../../renderers/electrobun/view/host/text";
import { WebScrollBox } from "../../../renderers/electrobun/view/host/scroll-box";
import { WebInput } from "../../../renderers/electrobun/view/host/input";
import { WebButton, WebTextField } from "../../../renderers/electrobun/view/desktop/controls";
import { PluginGalleryDesktop, type PluginGalleryController } from "./gallery-desktop";
import type { MarketplaceEntry } from "./model";

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

function entry(overrides: Partial<MarketplaceEntry> & Pick<MarketplaceEntry, "id" | "name">): MarketplaceEntry {
  return {
    tagline: "",
    categories: ["data"],
    tier: "community",
    targets: ["cli", "tui", "desktop", "web"],
    hosts: [],
    stars: 0,
    featured: false,
    bundled: false,
    installed: false,
    enabled: false,
    toggleable: true,
    unsupportedHere: false,
    repo: `gloom-sh/${overrides.id}`,
    ...overrides,
  };
}

function createController(overrides: Partial<PluginGalleryController> = {}): {
  controller: PluginGalleryController;
  installCalls: MarketplaceEntry[];
  toggleCalls: MarketplaceEntry[];
  selections: string[];
} {
  const installCalls: MarketplaceEntry[] = [];
  const toggleCalls: MarketplaceEntry[] = [];
  const selections: string[] = [];
  const controller: PluginGalleryController = {
    query: "",
    setQuery: () => {},
    installed: [],
    discover: [],
    selected: null,
    select: (id) => selections.push(id),
    status: "ready",
    refresh: () => {},
    install: (next) => installCalls.push(next),
    toggle: (next) => toggleCalls.push(next),
    installing: null,
    installError: null,
    installedNow: [],
    canInstall: false,
    canToggle: false,
    openSource: () => {},
    sourceUrl: null,
    ...overrides,
  };
  return { controller, installCalls, toggleCalls, selections };
}

async function renderGallery(controller: PluginGalleryController) {
  const container = testWindow.document.createElement("div");
  testWindow.document.body.appendChild(container);
  root = createRoot(container as unknown as HTMLElement);
  await act(async () => {
    root!.render(
      <UiHostProvider ui={ui} renderer={renderer}>
        <PluginGalleryDesktop controller={controller} />
      </UiHostProvider>,
    );
  });
  return container;
}

function rows(container: Element) {
  return [...container.querySelectorAll('[data-gloom-role="plugin-gallery-row"]')];
}

function pressButton(container: Element, label: string) {
  const button = [...container.querySelectorAll('[data-gloom-role="desktop-button"]')]
    .find((node) => node.textContent?.includes(label));
  if (!button) throw new Error(`no button labelled ${label}`);
  return act(async () => {
    button.dispatchEvent(new testWindow.MouseEvent("mousedown", { bubbles: true, button: 0 }) as unknown as MouseEvent);
  });
}

test("sidebar rows select the preview instead of installing", async () => {
  const listed = entry({ id: "rss", name: "RSS", installed: true, enabled: true });
  const available = entry({ id: "hackernews", name: "Hacker News" });
  const { controller, installCalls, selections } = createController({
    installed: [listed],
    discover: [available],
    canInstall: true,
  });
  const container = await renderGallery(controller);

  const text = container.textContent ?? "";
  expect(text.indexOf("INSTALLED")).toBeLessThan(text.indexOf("DISCOVER"));

  const sidebarRows = rows(container);
  expect(sidebarRows.length).toBe(2);
  expect(sidebarRows[0]!.getAttribute("role")).toBe("button");
  expect(sidebarRows[0]!.getAttribute("tabindex")).toBe("0");
  expect(sidebarRows[0]!.getAttribute("aria-label")).toContain("RSS");

  await act(async () => {
    sidebarRows[0]!.dispatchEvent(new testWindow.MouseEvent("mousedown", { bubbles: true, button: 0 }) as unknown as MouseEvent);
  });
  await act(async () => {
    sidebarRows[1]!.dispatchEvent(new testWindow.MouseEvent("mouseover", { bubbles: true }) as unknown as MouseEvent);
  });
  await act(async () => {
    (sidebarRows[1] as unknown as HTMLElement).focus();
  });

  expect(selections).toEqual(["rss", "hackernews", "hackernews"]);
  expect(installCalls).toEqual([]);
});

test("preview of an installable discover plugin installs that entry", async () => {
  const available = entry({ id: "hackernews", name: "Hacker News", tagline: "Front page" });
  const { controller, installCalls } = createController({
    discover: [available],
    selected: available,
    canInstall: true,
  });
  const container = await renderGallery(controller);

  const preview = container.querySelector('[data-gloom-role="plugin-gallery-preview"]')!;
  const previewText = preview.textContent ?? "";
  expect(previewText).toContain("Hacker News");
  expect(previewText).toContain("Install Plugin");
  expect(previewText).toContain("Loads after restart");

  await pressButton(preview, "Install Plugin");
  expect(installCalls).toEqual([available]);
});

test("preview of an installed toggleable plugin toggles that entry", async () => {
  const listed = entry({
    id: "rss",
    name: "RSS",
    installed: true,
    enabled: true,
    toggleable: true,
  });
  const { controller, toggleCalls } = createController({
    installed: [listed],
    selected: listed,
    canToggle: true,
  });
  const container = await renderGallery(controller);

  const preview = container.querySelector('[data-gloom-role="plugin-gallery-preview"]')!;
  expect(preview.textContent).toContain("Disable");

  await pressButton(preview, "Disable");
  expect(toggleCalls).toEqual([listed]);
});

test("an empty gallery keeps a preview placeholder instead of a blank pane", async () => {
  const { controller } = createController();
  const container = await renderGallery(controller);

  expect(rows(container).length).toBe(0);
  const empty = container.querySelector('[data-gloom-role="plugin-gallery-preview-empty"]')!;
  expect(empty.textContent).toContain("No plugin selected.");
  expect(container.querySelector('[data-gloom-role="plugin-gallery-preview"]')).toBeNull();
});
