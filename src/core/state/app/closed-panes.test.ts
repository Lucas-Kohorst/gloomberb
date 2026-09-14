import { describe, expect, test } from "bun:test";
import {
  MAX_CLOSED_PANES,
  popClosedPane,
  pushClosedPane,
} from "./closed-panes";
import type { ClosedPane } from "./types";

function closedPane(id: string): ClosedPane {
  return {
    instance: { instanceId: id, paneId: "ticker-detail", binding: { kind: "none" } },
    paneState: { activeTabId: id },
  };
}

describe("closed pane stack", () => {
  test("pops the most recent pane and retains only the latest ten", () => {
    const stack = Array.from({ length: MAX_CLOSED_PANES + 2 }, (_, index) => closedPane(String(index)))
      .reduce((all, pane) => pushClosedPane(all, pane), [] as ClosedPane[]);

    expect(stack.map((pane) => pane.instance.instanceId)).toEqual(
      Array.from({ length: MAX_CLOSED_PANES }, (_, index) => String(index + 2)),
    );
    const popped = popClosedPane(stack);
    expect(popped.pane?.instance.instanceId).toBe(String(MAX_CLOSED_PANES + 1));
    expect(popped.stack.map((pane) => pane.instance.instanceId)).toEqual(
      Array.from({ length: MAX_CLOSED_PANES - 1 }, (_, index) => String(index + 2)),
    );
  });
});
