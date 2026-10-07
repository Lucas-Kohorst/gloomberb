import { cp, readdir, rm, stat, writeFile } from "fs/promises";
import { join } from "path";

/**
 * Electrobun serves a views:// file only when its body length is greater than zero.
 * Webpack's empty CSS chunk is zero bytes, and the drawing rail, header, and timeframe bar wait on that request.
 */
export async function stampEmptyChartChunks(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await stampEmptyChartChunks(path);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!path.endsWith(".css") && !path.endsWith(".js")) continue;
    if ((await stat(path)).size !== 0) continue;
    await writeFile(path, "\n");
  }
}

/**
 * The widget loads bundles from `library_path` at runtime.
 * `auto` still mounts TradingView on the hosted page, so a missing library
 * must fail the build. `GLOOM_CHART_BACKEND=custom` is the canvas-only build.
 */
export async function copyChartingLibrary(
  outdir: string,
  source = join(process.cwd(), "vendor", "charting_library", "charting_library"),
): Promise<void> {
  const dest = join(outdir, "charting_library");
  await rm(dest, { recursive: true, force: true });
  try {
    await stat(source);
  } catch {
    if ((process.env.GLOOM_CHART_BACKEND ?? "").trim().toLowerCase() === "custom") return;
    throw new Error(
      "vendor/charting_library is missing. Hosted and desktop builds mount TradingView unless GLOOM_CHART_BACKEND=custom.",
    );
  }
  await cp(source, dest, { recursive: true });
  await stampEmptyChartChunks(dest);
}
