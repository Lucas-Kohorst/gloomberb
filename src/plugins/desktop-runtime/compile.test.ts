import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { compileExternalPlugins } from "./compile";

describe("compileExternalPlugins", () => {
  test("compiles a gloomberb/ui pane plugin to browser JS without node specifiers", async () => {
    const root = mkdtempSync(join(tmpdir(), "gloomberb-desktop-plugins-"));
    const dir = join(root, "hello-world");
    mkdirSync(dir);
    writeFileSync(join(dir, "index.tsx"), `
import type { GloomPlugin, PaneProps } from "gloomberb/types/plugin";
import { Box, Text } from "gloomberb/ui";

function HelloPane(_props: PaneProps) {
  return <Box><Text>Hello</Text></Box>;
}

const plugin: GloomPlugin = {
  id: "hello-world",
  name: "Hello World",
  version: "0.1.0",
  setup(ctx) {
    ctx.registerPane({
      id: "hello-world",
      name: "Hello World",
      component: HelloPane,
    });
  },
};

export default plugin;
`);
    const bundles = await compileExternalPlugins(root);
    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.error).toBeUndefined();
    expect(bundles[0]?.js).toContain("GloomReact.createElement");
    expect(bundles[0]?.js).toContain("__GLOOM_PLUGIN_RUNTIME");
    expect(bundles[0]?.js).not.toContain("from \"gloomberb/ui\"");
    expect(bundles[0]?.js).not.toContain("from \"fs\"");
  });

  test("records a compile error instead of throwing", async () => {
    const root = mkdtempSync(join(tmpdir(), "gloomberb-desktop-plugins-bad-"));
    const dir = join(root, "broken");
    mkdirSync(dir);
    writeFileSync(join(dir, "index.ts"), `export default {\n  id: "broken"\n  name: "Broken",\n};\n`);
    const bundles = await compileExternalPlugins(root);
    expect(bundles[0]?.error).toBeTruthy();
    expect(bundles[0]?.js).toBeUndefined();
  });
});
