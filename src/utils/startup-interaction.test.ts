import { afterEach, describe, expect, test } from "bun:test";
import {
  armStartupInteractiveAfterFirstPaint,
  enableStartupNetworkDeferral,
  isStartupNetworkDeferred,
  markStartupInteractive,
  resetStartupInteractionForTests,
  runAfterStartupBackground,
  STARTUP_BACKGROUND_IDLE_TIMEOUT_MS,
  whenStartupBackground,
} from "./startup-interaction";

afterEach(() => {
  resetStartupInteractionForTests();
});

describe("startup interaction gate", () => {
  test("resolves immediately when deferral is not enabled", async () => {
    let ran = false;
    await whenStartupBackground();
    ran = true;
    expect(ran).toBe(true);
    expect(isStartupNetworkDeferred()).toBe(false);
  });

  test("holds background work until first paint is marked", async () => {
    enableStartupNetworkDeferral();
    expect(isStartupNetworkDeferred()).toBe(true);

    let released = false;
    const pending = whenStartupBackground().then(() => {
      released = true;
    });
    await Bun.sleep(20);
    expect(released).toBe(false);

    markStartupInteractive();
    await pending;
    expect(released).toBe(true);
    expect(isStartupNetworkDeferred()).toBe(false);
  });

  test("runAfterStartupBackground can be cancelled before it runs", async () => {
    enableStartupNetworkDeferral();
    let ran = 0;
    const cancel = runAfterStartupBackground(() => {
      ran += 1;
    });
    cancel();
    markStartupInteractive();
    await Bun.sleep(20);
    expect(ran).toBe(0);
  });

  test("idle timeout marks interactive when rAF never fires", async () => {
    const host = globalThis as typeof globalThis & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const previousIdle = host.requestIdleCallback;
    const previousCancel = host.cancelIdleCallback;
    const timeouts: number[] = [];
    let idleCallback: (() => void) | null = null;
    host.requestIdleCallback = (callback, options) => {
      timeouts.push(options?.timeout ?? -1);
      idleCallback = callback;
      return 1;
    };
    host.cancelIdleCallback = () => {
      idleCallback = null;
    };

    try {
      enableStartupNetworkDeferral();
      expect(timeouts).toEqual([STARTUP_BACKGROUND_IDLE_TIMEOUT_MS]);
      expect(isStartupNetworkDeferred()).toBe(true);
      idleCallback?.();
      expect(isStartupNetworkDeferred()).toBe(false);
    } finally {
      if (previousIdle) host.requestIdleCallback = previousIdle;
      else delete host.requestIdleCallback;
      if (previousCancel) host.cancelIdleCallback = previousCancel;
      else delete host.cancelIdleCallback;
    }
  });

  test("armStartupInteractiveAfterFirstPaint marks on double rAF", async () => {
    enableStartupNetworkDeferral();
    const frames: Array<() => void> = [];
    const previousRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      frames.push(() => callback(0));
      return frames.length;
    }) as typeof requestAnimationFrame;

    try {
      armStartupInteractiveAfterFirstPaint();
      expect(isStartupNetworkDeferred()).toBe(true);
      expect(frames).toHaveLength(1);
      frames[0]!();
      expect(frames).toHaveLength(2);
      expect(isStartupNetworkDeferred()).toBe(true);
      frames[1]!();
      expect(isStartupNetworkDeferred()).toBe(false);
    } finally {
      if (previousRaf) globalThis.requestAnimationFrame = previousRaf;
      else delete (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame;
    }
  });
});
