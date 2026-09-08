import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { setPluginsDirForTests } from "../../loader";
import { scanExternalPlugins } from "./operations";

let tempRoot: string | undefined;

afterEach(() => {
  if (!tempRoot) return;
  setPluginsDirForTests(null);
  rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

describe("scanExternalPlugins", () => {
  test("maps loader discovery into package.json metadata, including monorepo packages", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "gloomberb-scan-"));
    setPluginsDirForTests(tempRoot);

    const direct = join(tempRoot, "direct");
    mkdirSync(direct, { recursive: true });
    writeFileSync(join(direct, "index.ts"), "export default {};\n");
    writeFileSync(join(direct, "package.json"), JSON.stringify({ version: "1.2.3", description: "Direct" }));

    const repo = join(tempRoot, "gloomberb-plugins", "plugins", "weather");
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, "index.ts"), "export default {};\n");
    writeFileSync(join(repo, "package.json"), JSON.stringify({ version: "4.5.6", description: "Weather" }));

    const broken = join(tempRoot, "broken");
    mkdirSync(broken, { recursive: true });
    writeFileSync(join(broken, "index.ts"), "export default {};\n");
    writeFileSync(join(broken, "package.json"), "{ not json");

    const entries = await scanExternalPlugins();

    const directEntry = entries.find((entry) => entry.dirName === "direct")!;
    expect(directEntry.version).toBe("1.2.3");
    expect(directEntry.description).toBe("Direct");
    expect(directEntry.hasError).toBe(false);
    expect(directEntry.managementDirName).toBeUndefined();

    const weatherEntry = entries.find((entry) => entry.dirName === "weather")!;
    expect(weatherEntry.version).toBe("4.5.6");
    expect(weatherEntry.description).toBe("Weather");
    expect(weatherEntry.managementDirName).toBe("gloomberb-plugins");

    const brokenEntry = entries.find((entry) => entry.dirName === "broken")!;
    expect(brokenEntry.hasError).toBe(true);
    expect(brokenEntry.description).toBe("Unreadable package.json");
  });
});
