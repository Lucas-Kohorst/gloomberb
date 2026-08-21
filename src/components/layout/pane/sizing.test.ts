import { describe, expect, test } from "bun:test";
import { resolveNativePaneHeaderRows, resolvePaneBodyFrame, shouldReservePaneFooter } from "./sizing";

describe("pane sizing", () => {
  test("lets native pane chrome lay out footer bars in normal flex flow", () => {
    expect(shouldReservePaneFooter(true, true)).toBe(false);

    const headerRows = resolveNativePaneHeaderRows(18);
    const bodyFrame = resolvePaneBodyFrame({
      width: 80,
      height: 30,
      nativePaneChrome: true,
      footerVisible: true,
      reserveFooter: false,
      headerRows,
    });

    expect(headerRows).toBeCloseTo(28 / 18);
    expect(bodyFrame.height).toBeCloseTo(30 - headerRows - 1);
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
    });
  });
});
