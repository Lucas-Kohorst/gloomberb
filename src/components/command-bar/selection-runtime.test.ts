import { describe, expect, test } from "bun:test";
import type { ResultItem } from "./list/model";
import { resolvePendingEnter } from "./selection-runtime";

function row(partial: Partial<ResultItem> & Pick<ResultItem, "id" | "kind">): ResultItem {
  return {
    label: partial.id,
    detail: "",
    category: "Commands",
    action: () => {},
    ...partial,
  };
}

describe("resolvePendingEnter", () => {
  test("an exact listing takes Enter ahead of the command that was waiting", () => {
    const command = row({ id: "crash", kind: "command" });
    const listing = row({ id: "ticker:ON", kind: "ticker", category: "Exact Match", label: "ON" });
    expect(resolvePendingEnter([listing, command], command)?.id).toBe("ticker:ON");
  });

  test("a mnemonic listing does not take Enter", () => {
    const command = row({ id: "des", kind: "command" });
    const listing = row({
      id: "ticker:T",
      kind: "ticker",
      category: "Exact Match",
      defaultSelectable: false,
    });
    expect(resolvePendingEnter([listing, command], command)?.id).toBe("des");
  });

  test("no listing leaves the waiting command", () => {
    const command = row({ id: "crash", kind: "command" });
    expect(resolvePendingEnter([command], command)?.id).toBe("crash");
    expect(resolvePendingEnter([], null)).toBeNull();
  });
});
