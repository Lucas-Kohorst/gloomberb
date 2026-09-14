import { expect, jest, test } from "bun:test";
import {
  clampTableScrollIndex,
  createDebouncedTableScrollWriter,
} from "./scroll-state";

test("clamps restored table scroll indexes to the available rows", () => {
  expect(clampTableScrollIndex(-3, 10)).toBe(0);
  expect(clampTableScrollIndex(4.9, 10)).toBe(4);
  expect(clampTableScrollIndex(50, 10)).toBe(9);
  expect(clampTableScrollIndex(4, 0)).toBe(0);
  expect(clampTableScrollIndex(Number.NaN, 10)).toBe(0);
});

test("coalesces table scroll writes and flushes the latest position", () => {
  const writes: number[] = [];
  const writer = createDebouncedTableScrollWriter((index) => writes.push(index), 20);

  jest.useFakeTimers();
  try {
    writer.schedule(3);
    writer.schedule(8);
    jest.advanceTimersByTime(19);
    expect(writes).toEqual([]);

    jest.advanceTimersByTime(1);
    expect(writes).toEqual([8]);

    writer.schedule(12);
    writer.flush();
    expect(writes).toEqual([8, 12]);
  } finally {
    jest.useRealTimers();
  }
});
