import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { handleChartCommandBarKey } from "./charting-library-keyboard";

test("command K inside a chart stops chart shortcuts but ordinary typing remains untouched", () => {
  const window = new Window();
  let opened = 0;
  let chartHandled = 0;
  window.addEventListener("keydown", (event) => handleChartCommandBarKey(event as unknown as KeyboardEvent, () => { opened++; }), true);
  window.addEventListener("keydown", () => { chartHandled++; });
  for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
    const event = new window.KeyboardEvent("keydown", { key: "k", cancelable: true, ...modifier });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  }
  expect(opened).toBe(2);
  expect(chartHandled).toBe(0);
  for (const options of [{ key: "k" }, { key: "s", metaKey: true }, { key: "k", ctrlKey: true, isComposing: true }]) {
    const event = new window.KeyboardEvent("keydown", { cancelable: true, ...options });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
  expect(opened).toBe(2);
  expect(chartHandled).toBe(3);
});

test("iframe navigation reattaches the shortcut and cleanup removes it", async () => {
  const { bindChartCommandBarKey } = await import("./charting-library-keyboard");
  const window = new Window();
  const previous = globalThis.MutationObserver;
  globalThis.MutationObserver = window.MutationObserver as unknown as typeof MutationObserver;
  try {
    const container = window.document.createElement("div");
    window.document.body.appendChild(container);
    let opened = 0;
    const stop = bindChartCommandBarKey(container as unknown as HTMLElement, () => { opened++; });
    const frame = window.document.createElement("iframe");
    container.appendChild(frame);
    await window.happyDOM.waitUntilComplete();
    const press = () => frame.contentWindow!.dispatchEvent(new window.KeyboardEvent("keydown", { key: "k", ctrlKey: true, cancelable: true }));
    press();
    expect(opened).toBe(1);
    frame.dispatchEvent(new window.Event("load"));
    press();
    expect(opened).toBe(2);
    stop();
    press();
    expect(opened).toBe(2);
  } finally {
    globalThis.MutationObserver = previous;
    await window.happyDOM.close();
  }
});
