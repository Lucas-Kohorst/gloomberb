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

/** The widget loads bundles from `library_path` at runtime. Ship the submodule's static folder next to the page. */
export async function copyChartingLibrary(outdir: string): Promise<void> {
  const source = join(process.cwd(), "vendor", "charting_library", "charting_library");
  const dest = join(outdir, "charting_library");
  await rm(dest, { recursive: true, force: true });
  await cp(source, dest, { recursive: true });
  await stampEmptyChartChunks(dest);
}
