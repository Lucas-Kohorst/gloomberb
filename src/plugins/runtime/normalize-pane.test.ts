import { describe, expect, test } from "bun:test";
import { isValidElement } from "react";
import { normalizeRegisteredPane } from "./normalize-pane";

describe("normalizeRegisteredPane", () => {
  test("keeps a real component", () => {
    const component = () => null;
    const pane = normalizeRegisteredPane({
      id: "ok",
      name: "Ok",
      defaultPosition: "left",
      component,
    });
    expect(pane.component).toBe(component);
    expect(pane.defaultPosition).toBe("left");
  });

  test("maps Agent title/render registrations onto a React pane", () => {
    const pane = normalizeRegisteredPane({
      id: "mixed-watchlist",
      title: "Mixed Watch",
      render: () => "MIXED WATCHLIST",
    });
    expect(pane.name).toBe("Mixed Watch");
    expect(pane.defaultPosition).toBe("right");
    const node = pane.component({
      paneId: "mixed-watchlist:1",
      paneType: "mixed-watchlist",
      focused: true,
      width: 40,
      height: 12,
    });
    expect(isValidElement(node)).toBe(true);
  });

  test("does not leave component undefined when both component and render are missing", () => {
    const pane = normalizeRegisteredPane({ id: "broken" });
    expect(typeof pane.component).toBe("function");
    const node = pane.component({
      paneId: "broken:1",
      paneType: "broken",
      focused: false,
      width: 20,
      height: 8,
    });
    expect(isValidElement(node)).toBe(true);
  });
});
