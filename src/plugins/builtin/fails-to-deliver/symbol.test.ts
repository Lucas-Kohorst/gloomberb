import { expect, test } from "bun:test";
import { resolveFailSymbol } from "./model";

test("a typed symbol wins over the command and the linked ticker", () => {
  expect(resolveFailSymbol("spy", "AAPL", "MSFT")).toBe("SPY");
  expect(resolveFailSymbol("", "AAPL", "MSFT")).toBe("AAPL");
  expect(resolveFailSymbol("  ", "", "msft")).toBe("MSFT");
  expect(resolveFailSymbol("", "", "")).toBe("");
});
