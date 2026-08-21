import { describe, expect, test } from "bun:test";
import { scheduleOnIdle } from "./schedule-on-idle";

type IdleHost = typeof globalThis & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

describe("scheduleOnIdle", () => {
  test("falls back to a zero-delay timer when IdleCallback is missing", async () => {
    const host = globalThis as IdleHost;
    const previousIdle = host.requestIdleCallback;
    const previousCancel = host.cancelIdleCallback;
    delete host.requestIdleCallback;
    delete host.cancelIdleCallback;

    try {
      let ran = 0;
      const cancel = scheduleOnIdle(() => {
        ran += 1;
      }, 4_000);
      await Bun.sleep(20);
      expect(ran).toBe(1);
      cancel();
    } finally {
      if (previousIdle) host.requestIdleCallback = previousIdle;
      if (previousCancel) host.cancelIdleCallback = previousCancel;
    }
  });

  test("cancels a pending IdleCallback before it runs", async () => {
    const host = globalThis as IdleHost;
    const previousIdle = host.requestIdleCallback;
    const previousCancel = host.cancelIdleCallback;
    const pending = new Map<number, () => void>();
    let nextHandle = 1;
    host.requestIdleCallback = (callback) => {
      const handle = nextHandle++;
      pending.set(handle, callback);
      return handle;
    };
    host.cancelIdleCallback = (handle) => {
      pending.delete(handle);
    };

    try {
      let ran = 0;
      const cancel = scheduleOnIdle(() => {
        ran += 1;
      }, 4_000);
      cancel();
      for (const callback of pending.values()) callback();
      expect(ran).toBe(0);
    } finally {
      if (previousIdle) host.requestIdleCallback = previousIdle;
      else delete host.requestIdleCallback;
      if (previousCancel) host.cancelIdleCallback = previousCancel;
      else delete host.cancelIdleCallback;
    }
  });
});
