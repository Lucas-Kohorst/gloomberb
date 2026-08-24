import { describe, expect, test } from "bun:test";
import { getThemeColors, hoverBg, paneBg, paneTitleBg } from "../../theme/colors";
import { DEFAULT_THEME, getTheme } from "../../theme/themes";

function cssRootToken(css: string, name: string): string | undefined {
  const match = css.match(new RegExp(`${name}:\\s*([^;]+);`));
  return match?.[1]?.trim().toLowerCase();
}

describe("share page theme tokens", () => {
  test("hardcodes the normalized Adjacent default so anonymous share pages match new installs", async () => {
    expect(DEFAULT_THEME).toBe("adjacent");
    const css = await Bun.file(new URL("./styles.css", import.meta.url)).text();
    const theme = getTheme("adjacent");
    const palette = getThemeColors("adjacent");

    expect(cssRootToken(css, "--gloom-bg")).toBe(theme.bg.toLowerCase());
    expect(cssRootToken(css, "--gloom-panel")).toBe(theme.panel.toLowerCase());
    expect(cssRootToken(css, "--gloom-border")).toBe(theme.border.toLowerCase());
    expect(cssRootToken(css, "--gloom-border-focused")).toBe(theme.borderFocused.toLowerCase());
    expect(cssRootToken(css, "--gloom-text")).toBe(theme.text.toLowerCase());
    expect(cssRootToken(css, "--gloom-text-dim")).toBe(theme.textDim.toLowerCase());
    expect(cssRootToken(css, "--gloom-text-bright")).toBe(theme.textBright.toLowerCase());
    expect(cssRootToken(css, "--gloom-text-muted")).toBe(theme.textMuted.toLowerCase());
    expect(cssRootToken(css, "--gloom-positive")).toBe(theme.positive.toLowerCase());
    expect(cssRootToken(css, "--gloom-negative")).toBe(theme.negative.toLowerCase());
    expect(cssRootToken(css, "--gloom-neutral")).toBe(theme.neutral.toLowerCase());
    expect(cssRootToken(css, "--gloom-warning")).toBe(theme.warning.toLowerCase());
    expect(cssRootToken(css, "--gloom-selected")).toBe(theme.selected.toLowerCase());
    expect(cssRootToken(css, "--gloom-selected-text")).toBe(theme.selectedText.toLowerCase());
    expect(cssRootToken(css, "--gloom-hover-bg")).toBe(hoverBg(palette).toLowerCase());
    expect(cssRootToken(css, "--gloom-pane-title-bg")).toBe(paneTitleBg(true, palette).toLowerCase());
    expect(cssRootToken(css, "--gloom-pane-body-bg")).toBe(paneBg(true, palette).toLowerCase());
    expect(cssRootToken(css, "--gloom-pane-footer-bg")).toBe(paneBg(true, palette).toLowerCase());
  });
});
