import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { listExternalPluginEntries } from "./loader";

let tempRoot: string | undefined;

afterEach(() => {
  if (!tempRoot) return;
  rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

describe("external plugin loader", () => {
  test("discovers plugins nested inside a monorepo directory", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "gloomberb-plugins-"));
    const directDir = join(tempRoot, "direct");
    const monorepoDir = join(tempRoot, "gloomberb-plugins");
    const nestedDir = join(monorepoDir, "weather");
    const nestedNodeModulesDir = join(monorepoDir, "node_modules", "ignored");

    mkdirSync(directDir, { recursive: true });
    mkdirSync(nestedDir, { recursive: true });
    mkdirSync(nestedNodeModulesDir, { recursive: true });
    writeFileSync(join(directDir, "index.ts"), "export default {};\n");
    writeFileSync(join(nestedDir, "index.ts"), "export default {};\n");
    writeFileSync(join(nestedNodeModulesDir, "index.ts"), "export default {};\n");

    const entries = await listExternalPluginEntries(tempRoot);

    expect(entries.map((entry) => entry.dirName).sort()).toEqual(["direct", "weather"]);
    expect(entries.find((entry) => entry.dirName === "weather")?.pluginDir).toBe(nestedDir);
  });
});
