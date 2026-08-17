import { describe, expect, test } from "bun:test";
import { findRelativeAssetUrls, toRootAbsoluteAssetUrl } from "./asset-urls";

describe("hosted asset URLs", () => {
  test("flags relative src and href that break under nested SPA routes", () => {
    const html = `
      <link rel="icon" href="favicon.svg" />
      <script type="module" src="./web-main.js"></script>
      <img src="/ok.png" />
      <a href="https://example.com/x">ext</a>
      <link href="data:image/svg+xml,x" />
    `;
    expect(findRelativeAssetUrls(html)).toEqual(["favicon.svg", "./web-main.js"]);
  });

  test("rewrites relative paths to root-absolute", () => {
    expect(toRootAbsoluteAssetUrl("./web-main.js")).toBe("/web-main.js");
    expect(toRootAbsoluteAssetUrl("favicon.svg")).toBe("/favicon.svg");
    expect(toRootAbsoluteAssetUrl("/already.js")).toBe("/already.js");
  });
});
