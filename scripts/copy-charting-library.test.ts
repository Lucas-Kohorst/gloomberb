import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { copyChartingLibrary, stampEmptyChartChunks } from "./copy-charting-library";

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

describe("copyChartingLibrary", () => {
  test("refuses a TradingView build when the library checkout is missing", async () => {
    const out = await mkdtemp(join(tmpdir(), "chart-copy-"));
    const missing = join(out, "missing");
    const previous = process.env.GLOOM_CHART_BACKEND;
    delete process.env.GLOOM_CHART_BACKEND;
    try {
      await expect(copyChartingLibrary(out, missing)).rejects.toThrow(/vendor\/charting_library is missing/);
      process.env.GLOOM_CHART_BACKEND = "custom";
      await copyChartingLibrary(out, missing);
    } finally {
      if (previous === undefined) delete process.env.GLOOM_CHART_BACKEND;
      else process.env.GLOOM_CHART_BACKEND = previous;
    }
  });

});
