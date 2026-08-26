import { describe, expect, test } from "bun:test";
import { rewriteGloomImports, withJsxRuntimePrelude } from "./rewrite";

describe("rewriteGloomImports", () => {
  test("rewrites named gloomberb imports to the desktop runtime global", () => {
    const source = `import type { GloomPlugin } from "gloomberb/types/plugin";
import { Box, Text } from "gloomberb/ui";
import { colors } from "gloomberb/theme/colors";
export const plugin = { id: "hello" };
`;
    const rewritten = rewriteGloomImports(source);
    expect(rewritten).not.toContain("from \"gloomberb/ui\"");
    expect(rewritten).not.toContain("from \"gloomberb/types/plugin\"");
    expect(rewritten).toContain("const { Box, Text } = globalThis.__GLOOM_PLUGIN_RUNTIME[\"gloomberb/ui\"];");
    expect(rewritten).toContain("const { colors } = globalThis.__GLOOM_PLUGIN_RUNTIME[\"gloomberb/theme/colors\"];");
    expect(rewritten).toContain("export const plugin");
  });

  test("rewrites namespace and default react imports", () => {
    const source = `import * as React from "react";
import { useState } from "react";
`;
    const rewritten = rewriteGloomImports(source);
    expect(rewritten).toContain("const React = globalThis.__GLOOM_PLUGIN_RUNTIME[\"react\"];");
    expect(rewritten).toContain("const { useState } = globalThis.__GLOOM_PLUGIN_RUNTIME[\"react\"];");
  });

  test("leaves relative imports for the bundler", () => {
    const source = `import { helper } from "./util";\n`;
    expect(rewriteGloomImports(source)).toBe(source);
  });

  test("adds a JSX factory prelude", () => {
    expect(withJsxRuntimePrelude("export default {}")).toContain("GloomReact");
  });
});
