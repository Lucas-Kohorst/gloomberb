import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { setPluginsDirForTests } from "../../../plugins/loader";
import { removeExternalPlugin } from "./external-plugins";

let tempRoot: string | undefined;

afterEach(() => {
  if (!tempRoot) return;
  setPluginsDirForTests(null);
  rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

function makePluginDir(dir: string, id: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.ts"), `export default { id: ${JSON.stringify(id)}, name: ${JSON.stringify(id)} };\n`);
}

function makeMonorepo(): string {
  tempRoot = mkdtempSync(join(tmpdir(), "gloomberb-uninstall-"));
  setPluginsDirForTests(tempRoot);
  const repo = join(tempRoot, "gloomberb-plugins");
  mkdirSync(repo, { recursive: true });
  return repo;
}

describe("removeExternalPlugin", () => {
  test("removes exactly the selected package directory inside a monorepo and preserves the repo and its siblings", async () => {
    const repo = makeMonorepo();
    makePluginDir(join(repo, "weather"), "weather");
    writeFileSync(join(repo, "weather", "keep.txt"), "untouched");

    const traffic = join(repo, "traffic");
    makePluginDir(traffic, "traffic");

    const result = await removeExternalPlugin("weather");

    expect(result.ok).toBe(true);
    expect(existsSync(join(repo, "weather"))).toBe(false);
    expect(existsSync(join(repo, "traffic"))).toBe(true);
    expect(existsSync(repo)).toBe(true);
  });

  test("matches a package whose plugin id differs from its directory name", async () => {
    const repo = makeMonorepo();
    makePluginDir(join(repo, "weather"), "weather-ext");

    const result = await removeExternalPlugin("weather-ext");

    expect(result.ok).toBe(true);
    expect(existsSync(join(repo, "weather"))).toBe(false);
    expect(existsSync(repo)).toBe(true);
  });

  test("returns an error when no package matches", async () => {
    const repo = makeMonorepo();
    makePluginDir(join(repo, "weather"), "weather");

    const result = await removeExternalPlugin("missing");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("missing");
    expect(existsSync(join(repo, "weather"))).toBe(true);
  });
});
