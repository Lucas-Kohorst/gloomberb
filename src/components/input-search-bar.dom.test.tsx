/** @jsxImportSource react */
import { createTestRendererHost, createWebUiHost, installDomGlobals } from "../test-support/dom";

const testWindow = installDomGlobals();

import { afterEach, expect, test } from "bun:test";
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WebInputHostProvider } from "../renderers/electrobun/view/input-host";
import { AppContext, createInitialState } from "../state/app/context";
import { createDefaultConfig } from "../types/config";
import { UiHostProvider, type InputRenderable } from "../ui";
import { InputSearchBar } from "./input-search-bar";

const ui = createWebUiHost();
const renderer = createTestRendererHost();
const state = createInitialState(createDefaultConfig("/tmp/gloomberb-input-search-bar-dom"));
let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  testWindow.document.body.innerHTML = "";
});

function SearchBar({ placeholder, label }: { placeholder: string; label?: string }) {
  const inputRef = useRef<InputRenderable | null>(null);
  return (
    <InputSearchBar
      value=""
      focused={false}
      active={false}
      width={30}
      focusToken={0}
      inputRef={inputRef}
      placeholder={placeholder}
      label={label}
      debounceMs={0}
      onFocus={() => {}}
      onBlur={() => {}}
      onQueryChange={() => {}}
    />
  );
}

async function renderedLabel(props: { placeholder: string; label?: string }): Promise<string | null> {
  const container = testWindow.document.createElement("div");
  testWindow.document.body.append(container);
  root = createRoot(container as unknown as HTMLElement);
  await act(async () => root!.render(
    <AppContext value={{ state, dispatch: () => {} }}>
      <UiHostProvider ui={ui} renderer={renderer}>
        <WebInputHostProvider>
          <SearchBar {...props} />
        </WebInputHostProvider>
      </UiHostProvider>
    </AppContext>,
  ));
  const label = container.querySelector("input")?.getAttribute("aria-label") ?? null;
  await act(async () => root!.unmount());
  root = undefined;
  return label;
}

test("the DOM search field is named from its hint, or from an explicit label", async () => {
  expect(await renderedLabel({ placeholder: "title or source" })).toBe("Search title or source");
  expect(await renderedLabel({ placeholder: "filter headlines, sources, tickers…" })).toBe("filter headlines, sources, tickers");
  expect(await renderedLabel({ placeholder: "ticker", label: "Find a filing" })).toBe("Find a filing");
});
