import { describe, expect, test } from "bun:test";
import { resolvePaneBodyFrame, shouldReservePaneFooter } from "./sizing";

describe("pane sizing", () => {
  test("lets native pane chrome lay out footer bars in normal flex flow", () => {
    expect(shouldReservePaneFooter(true, true)).toBe(false);

    const bodyFrame = resolvePaneBodyFrame({
      width: 80,
      height: 30,
      nativePaneChrome: true,
      footerVisible: true,
      reserveFooter: false,
    });

    // The header is a 20px chrome row. The footer matches the status bar:
    // one 18px cell plus 15px of clearance.
    expect(bodyFrame.height).toBeCloseTo(30 - 20 / 18 - (18 + 15) / 18);
    expect(bodyFrame.layoutProps).toEqual({
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      minWidth: 0,
      minHeight: 0,
    });
  });

  test("keeps terminal pane footer rows reserved for border rendering", () => {
    expect(shouldReservePaneFooter(false, false)).toBe(true);

    const bodyFrame = resolvePaneBodyFrame({
      width: 80,
      height: 30,
      nativePaneChrome: false,
      reserveFooter: true,
    });

    expect(bodyFrame.height).toBe(28);
    expect(bodyFrame.layoutProps).toEqual({
      height: 28,
      flexGrow: 0,
      flexBasis: undefined,
      paddingX: 1,
    });
  });
});
