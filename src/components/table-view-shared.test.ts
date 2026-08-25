import { describe, expect, test } from "bun:test";
import {
  isTableScrollNearEnd,
  shouldInterceptNativeTableActivation,
} from "./table-view-shared";

describe("isTableScrollNearEnd", () => {
  test("is false until the remaining scroll is within the threshold", () => {
    const scrollBox = { scrollTop: 0, scrollHeight: 40, viewport: { height: 20 } };
    expect(isTableScrollNearEnd(scrollBox, 8)).toBe(false);
    scrollBox.scrollTop = 12;
    expect(isTableScrollNearEnd(scrollBox, 8)).toBe(true);
  });
});

describe("shouldInterceptNativeTableActivation", () => {
  const tabButton = {
    getAttribute: (name: string) => (name === "data-gloom-role" ? "tab-button" : null),
  };
  const dialogButton = {
    getAttribute: () => null,
    closest: () => null,
  };

  test("steals Enter from a focused pane tab so grouped rows can expand", () => {
    expect(shouldInterceptNativeTableActivation({ name: "return" }, tabButton)).toBe(true);
    expect(shouldInterceptNativeTableActivation({ name: "enter" }, tabButton)).toBe(true);
  });

  test("leaves dialog and other native buttons alone", () => {
    expect(shouldInterceptNativeTableActivation({ name: "return" }, dialogButton)).toBe(false);
    expect(shouldInterceptNativeTableActivation({ name: "return" }, null)).toBe(false);
    expect(shouldInterceptNativeTableActivation({ name: "j" }, tabButton)).toBe(false);
  });
});
