import { describe, expect, test } from "bun:test";
import {
  PANE_HEADER_GRIP,
  resolveTerminalPaneHeaderGeometry,
  terminalPaneHeaderControlAt,
  terminalPaneHeaderTitleHit,
} from "./terminal-header-geometry";
import { displayWidth } from "../../../utils/format";

describe("terminalPaneHeaderTitleHit", () => {
  test("hits the title after the grip and ignores header controls", () => {
    const geometry = resolveTerminalPaneHeaderGeometry(40, {
      floating: true,
      focused: true,
      showActions: true,
    });
    const titleX = geometry.contentStart + displayWidth(PANE_HEADER_GRIP) + 1;
    expect(terminalPaneHeaderTitleHit(geometry, titleX)).toBe(true);
    expect(terminalPaneHeaderTitleHit(geometry, geometry.contentStart)).toBe(false);
    const action = geometry.controls.action;
    expect(action).not.toBeNull();
    expect(terminalPaneHeaderControlAt(geometry, action!.start)).toBe("action");
    expect(terminalPaneHeaderTitleHit(geometry, action!.start)).toBe(false);
  });
});
