import { describe, expect, test } from "bun:test";

function cssRule(css: string, selector: string): string {
  const start = css.indexOf(selector);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  expect(open).toBeGreaterThan(start);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    const character = css[index];
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, index);
    }
  }
  throw new Error(`Unclosed CSS rule for ${selector}`);
}

describe("desktop chrome clip", () => {
  test("keeps footer and status glyphs above parent radius and overflow clips", async () => {
    const css = await Bun.file(new URL("./styles.css", import.meta.url)).text();

    const tiledWindow = cssRule(css, '[data-gloom-role="pane-window"][data-floating="false"]');
    expect(tiledWindow).toContain("overflow: visible");

    const floatingWindow = cssRule(css, '[data-gloom-role="pane-window"][data-floating="true"]');
    expect(floatingWindow).toContain("border-radius: 6px");
    expect(floatingWindow).toContain("overflow: hidden");

    const floatingFooter = cssRule(
      css,
      '[data-gloom-role="pane-window"][data-floating="true"] [data-gloom-role="pane-footer"]',
    );
    expect(floatingFooter).toContain("padding-bottom: 10px");
    expect(floatingFooter).toContain("min-height: calc(var(--cell-h) + 15px)");

    const paneBody = cssRule(css, '[data-gloom-role="pane-body"]');
    expect(paneBody).toContain("overflow: hidden");

    const statusBar = cssRule(css, '[data-gloom-role="status-bar"]');
    expect(statusBar).toContain("calc(var(--cell-h) + 15px)");
    expect(statusBar).toContain("padding-bottom: 10px");
    expect(statusBar).toContain("line-height: 1.15 !important");
    expect(statusBar).toContain("overflow: visible");
    expect(statusBar).toContain("border-top: 1px solid");
    expect(statusBar).toContain("z-index: 20");

    const composer = cssRule(css, '[data-gloom-role="desktop-message-composer"]');
    expect(composer).toContain("flex-shrink: 0 !important");
    expect(composer).toContain("overflow: visible");
  });
});
