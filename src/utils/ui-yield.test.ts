import { afterEach, describe, expect, test } from "bun:test";
import {
  noteUiInteraction,
  resetUiYieldForTests,
  setUiYieldReason,
  shouldYieldToUi,
  subscribeUiYield,
  UI_YIELD_QUIET_MS,
  whenUiQuiet,
} from "./ui-yield";

afterEach(() => {
  resetUiYieldForTests();
});

describe("ui yield", () => {
  test("is off until a reason or recent interaction is set", () => {
    expect(shouldYieldToUi()).toBe(false);
  });

  test("holds while chat input or the command bar is active", async () => {
    setUiYieldReason("input", true);
    expect(shouldYieldToUi()).toBe(true);

    let quiet = false;
    const pending = whenUiQuiet().then(() => {
      quiet = true;
    });
    await Bun.sleep(UI_YIELD_QUIET_MS + 20);
    expect(quiet).toBe(false);

    setUiYieldReason("input", false);
    await pending;
    expect(quiet).toBe(true);
    expect(shouldYieldToUi()).toBe(false);
  });

  test("keeps yielding through the quiet window after pointer up", async () => {
    setUiYieldReason("pointer", true);
    expect(shouldYieldToUi()).toBe(true);
    setUiYieldReason("pointer", false);
    expect(shouldYieldToUi()).toBe(true);
    await Bun.sleep(UI_YIELD_QUIET_MS + 20);
    expect(shouldYieldToUi()).toBe(false);
  });

  test("notifies subscribers when yield starts and ends", async () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeUiYield((yielding) => {
      seen.push(yielding);
    });
    expect(seen).toEqual([false]);

    noteUiInteraction();
    expect(seen).toEqual([false, true]);
    await Bun.sleep(UI_YIELD_QUIET_MS + 20);
    expect(seen).toEqual([false, true, false]);
    unsubscribe();
  });
});
