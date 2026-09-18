import { describe, expect, test } from "bun:test";
import { EventEmitter } from "events";
import { installCliRendererListenerHub } from "./listener-hub";
import {
  getOpenTuiViewportSnapshot,
  subscribeOpenTuiViewport,
} from "./viewport";
import type { NativeRendererHost } from "../../ui";

function createFakeRenderer(width = 80, height = 24) {
  const emitter = new EventEmitter();
  installCliRendererListenerHub(emitter);
  const renderer = Object.assign(emitter, {
    terminalWidth: width,
    terminalHeight: height,
  }) as unknown as NativeRendererHost & EventEmitter;
  return renderer;
}

describe("installCliRendererListenerHub", () => {
  test("keeps one real selection listener while many ScrollBox-style consumers attach", () => {
    const emitter = new EventEmitter();
    installCliRendererListenerHub(emitter);
    const calls: number[] = [];
    const handlers = Array.from({ length: 15 }, (_, index) => () => {
      calls.push(index);
    });

    for (const handler of handlers) emitter.on("selection", handler);
    expect(emitter.listenerCount("selection")).toBe(1);

    emitter.emit("selection");
    expect(calls).toEqual(Array.from({ length: 15 }, (_, index) => index));

    for (const handler of handlers) emitter.off("selection", handler);
    expect(emitter.listenerCount("selection")).toBe(0);
    emitter.emit("selection");
    expect(calls).toHaveLength(15);
  });

  test("hubs resize the same way and leaves other events alone", () => {
    const emitter = new EventEmitter();
    installCliRendererListenerHub(emitter);
    const resized: number[] = [];
    const focused: number[] = [];

    const onResizeA = () => resized.push(1);
    const onResizeB = () => resized.push(2);
    const onFocus = () => focused.push(1);

    emitter.on("resize", onResizeA);
    emitter.addListener("resize", onResizeB);
    emitter.on("focus", onFocus);

    expect(emitter.listenerCount("resize")).toBe(1);
    expect(emitter.listenerCount("focus")).toBe(1);

    emitter.emit("resize", 120, 40);
    emitter.emit("focus");
    expect(resized).toEqual([1, 2]);
    expect(focused).toEqual([1]);

    emitter.off("resize", onResizeA);
    emitter.removeListener("resize", onResizeB);
    expect(emitter.listenerCount("resize")).toBe(0);
  });

  test("once removes the hubbed handler after the first emit", () => {
    const emitter = new EventEmitter();
    installCliRendererListenerHub(emitter);
    let calls = 0;
    emitter.once("selection", () => {
      calls += 1;
    });
    expect(emitter.listenerCount("selection")).toBe(1);
    emitter.emit("selection");
    emitter.emit("selection");
    expect(calls).toBe(1);
    expect(emitter.listenerCount("selection")).toBe(0);
  });
});

describe("subscribeOpenTuiViewport", () => {
  test("shares one resize listener across consumers and detaches on last teardown", () => {
    const renderer = createFakeRenderer(80, 24);
    const snapshots: number[] = [];

    const unsubscribeA = subscribeOpenTuiViewport(renderer, () => snapshots.push(renderer.terminalWidth));
    const unsubscribeB = subscribeOpenTuiViewport(renderer, () => snapshots.push(renderer.terminalWidth));
    expect(renderer.listenerCount("resize")).toBe(1);

    renderer.terminalWidth = 140;
    renderer.emit("resize", 140, 24);
    expect(getOpenTuiViewportSnapshot(renderer)).toEqual({ width: 140, height: 24 });
    expect(snapshots).toEqual([140, 140]);

    unsubscribeA();
    expect(renderer.listenerCount("resize")).toBe(1);
    unsubscribeB();
    expect(renderer.listenerCount("resize")).toBe(0);
  });
});
