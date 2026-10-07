import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { stampEmptyChartChunks } from "./copy-charting-library";

describe("stampEmptyChartChunks", () => {
  test("writes one byte into an empty css or js chunk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chart-chunks-"));
    await mkdir(join(dir, "bundles"), { recursive: true });
    await writeFile(join(dir, "bundles", "empty.css"), "");
    await writeFile(join(dir, "bundles", "empty.js"), "");
    await writeFile(join(dir, "bundles", "kept.css"), "a{}");
    await writeFile(join(dir, "icon.png"), "");

    await stampEmptyChartChunks(dir);

    expect(await readFile(join(dir, "bundles", "empty.css"), "utf8")).toBe("\n");
    expect(await readFile(join(dir, "bundles", "empty.js"), "utf8")).toBe("\n");
    expect(await readFile(join(dir, "bundles", "kept.css"), "utf8")).toBe("a{}");
    expect((await stat(join(dir, "icon.png"))).size).toBe(0);
  });

});
