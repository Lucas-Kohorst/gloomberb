import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
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
  test("discovers plugins in a symlinked monorepo, in both `<repo>/<plugin>` and `<repo>/plugins/<plugin>` layouts", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "gloomberb-plugins-"));
    const directDir = join(tempRoot, "direct");
    const monorepoDir = join(tempRoot, ".gloomberb-plugins-source");
    const monorepoLink = join(tempRoot, "gloomberb-plugins");
    const flatDir = join(monorepoDir, "traffic");
    const nestedDir = join(monorepoDir, "plugins", "weather");
    const nestedNodeModulesDir = join(monorepoDir, "plugins", "node_modules", "ignored");

    mkdirSync(directDir, { recursive: true });
    mkdirSync(flatDir, { recursive: true });
    mkdirSync(nestedDir, { recursive: true });
    mkdirSync(nestedNodeModulesDir, { recursive: true });
    symlinkSync(monorepoDir, monorepoLink);
    writeFileSync(join(directDir, "index.ts"), "export default {};\n");
    writeFileSync(join(flatDir, "index.ts"), "export default {};\n");
    writeFileSync(join(nestedDir, "index.ts"), "export default {};\n");
    writeFileSync(join(nestedNodeModulesDir, "index.ts"), "export default {};\n");

    const entries = await listExternalPluginEntries(tempRoot);

    expect(entries.map((entry) => entry.dirName).sort()).toEqual(["direct", "traffic", "weather"]);
    const weather = entries.find((entry) => entry.dirName === "weather")!;
    const traffic = entries.find((entry) => entry.dirName === "traffic")!;
    const direct = entries.find((entry) => entry.dirName === "direct")!;

    // Nested packages resolve through the symlink and name their enclosing repo.
    expect(weather.pluginDir).toBe(join(monorepoLink, "plugins", "weather"));
    expect(weather.managementDirName).toBe("gloomberb-plugins");
    expect(traffic.pluginDir).toBe(join(monorepoLink, "traffic"));
    expect(traffic.managementDirName).toBe("gloomberb-plugins");

    // Top-level plugins have no management repo.
    expect(direct.pluginDir).toBe(directDir);
    expect(direct.managementDirName).toBeUndefined();
  });
});
