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
    expect(tiledWindow).toContain("overflow: clip");
    expect(tiledWindow).toContain("overscroll-behavior: none");

    const floatingWindow = cssRule(css, '[data-gloom-role="pane-window"][data-floating="true"]');
    expect(floatingWindow).toContain("border-radius: 6px");
    expect(floatingWindow).toContain("overflow: clip");
    expect(floatingWindow).toContain("overscroll-behavior: none");

    const floatingFooter = cssRule(
      css,
      '[data-gloom-role="pane-window"][data-floating="true"] [data-gloom-role="pane-footer"]',
    );
    expect(floatingFooter).toContain("padding-bottom: 10px");
    expect(floatingFooter).toContain("min-height: calc(var(--cell-h) + 15px)");

    const paneBody = cssRule(css, '[data-gloom-role="pane-body"]');
    expect(paneBody).toContain("overflow: clip");

    const paneContent = cssRule(css, '[data-gloom-role="pane-content"]');
    expect(paneContent).toContain("overflow: clip");

    const draggingIframe = cssRule(css, "body.gloom-dragging iframe");
    expect(draggingIframe).toContain("pointer-events: none");

    const draggingOverlay = cssRule(css, "body.gloom-dragging::after");
    expect(draggingOverlay).toContain("position: fixed");
    expect(draggingOverlay).toContain("inset: 0");

    const tvChart = cssRule(css, '[data-gloom-role="tradingview-chart"]');
    expect(tvChart).toContain("overflow: clip");
    expect(tvChart).toContain("touch-action: none");
    expect(tvChart).toContain("overscroll-behavior: none");

    const footerRuleStart = css.indexOf("position: relative;\n  z-index: 13;");
    expect(footerRuleStart).toBeGreaterThanOrEqual(0);
    const footerRule = css.slice(footerRuleStart, css.indexOf("}", footerRuleStart));
    expect(footerRule).toContain("pointer-events: none");
    const hintRuleStart = css.indexOf('[data-gloom-role="pane-footer"] [data-gloom-interactive="true"]');
    expect(hintRuleStart).toBeGreaterThanOrEqual(0);
    expect(css.slice(hintRuleStart, hintRuleStart + 220)).toContain("pointer-events: auto");

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

  test("desktop OpenTUI mapping uses pointer hover, focus rings, and overlay scrollbars", async () => {
    const css = await Bun.file(new URL("./styles.css", import.meta.url)).text();

    const selectedRow = cssRule(css, '[data-gloom-role="data-table-row"][data-selected="true"]');
    expect(selectedRow).toContain("inset 2px 0 0");

    const suggestionHover = cssRule(css, '[data-gloom-role="pane-suggestion"]:hover');
    expect(suggestionHover).toContain("background-color: var(--gloom-hover-bg)");

    const hintHover = cssRule(css, '[data-gloom-role="pane-hint"]:hover');
    expect(hintHover).toContain("background-color:");

    expect(css).toContain("[data-gloom-scrollbar-x]:hover");
    expect(css).toContain("[data-gloom-role=\"pane-close\"]:focus-visible");
  });
});
