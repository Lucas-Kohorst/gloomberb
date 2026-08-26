import { realpath } from "fs/promises";
import { join } from "path";
import { getPluginsDir, listExternalPluginEntries } from "../loader";
import { rewriteGloomImports, withJsxRuntimePrelude } from "./rewrite";
import type { DesktopExternalPluginBundle } from "./types";

export type { DesktopExternalPluginBundle };

function isInsideDir(filePath: string, dir: string): boolean {
  return filePath === dir || filePath.startsWith(`${dir}/`) || filePath.startsWith(`${dir}\\`);
}

async function compileEntry(entryFile: string, pluginDir: string): Promise<string> {
  const resolvedDir = await realpath(pluginDir).catch(() => pluginDir);
  let result: Awaited<ReturnType<typeof Bun.build>>;
  try {
    result = await Bun.build({
      entrypoints: [entryFile],
      target: "browser",
      format: "esm",
      minify: false,
      jsx: {
        runtime: "classic",
        factory: "GloomReact.createElement",
        fragment: "GloomReact.Fragment",
      },
      plugins: [{
        name: "gloom-plugin-runtime-imports",
        setup(build) {
          build.onLoad({ filter: /\.(ts|tsx|js|jsx)$/ }, async (args) => {
            const resolvedFile = await realpath(args.path).catch(() => args.path);
            if (!isInsideDir(resolvedFile, resolvedDir)) return undefined;
            const source = await Bun.file(args.path).text();
            const loader = args.path.endsWith("x") ? "tsx" : args.path.endsWith(".ts") ? "ts" : "js";
            return {
              contents: withJsxRuntimePrelude(rewriteGloomImports(source)),
              loader,
            };
          });
        },
      }],
    });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
  if (!result.success) {
    const message = result.logs.map((log) => String(log)).join("\n") || "Plugin compile failed.";
    throw new Error(message);
  }
  const outputs = result.outputs.filter((output) => output.path.endsWith(".js") || output.kind === "entry-point");
  const entry = outputs[0] ?? result.outputs[0];
  if (!entry) throw new Error("Plugin compile produced no JavaScript.");
  return await entry.text();
}

export async function compileExternalPlugins(
  rootDir = getPluginsDir(),
): Promise<DesktopExternalPluginBundle[]> {
  const plugins = await listExternalPluginEntries(rootDir);
  const bundles: DesktopExternalPluginBundle[] = [];
  for (const plugin of plugins) {
    try {
      const js = await compileEntry(plugin.entryFile, join(rootDir, plugin.dirName));
      bundles.push({ dirName: plugin.dirName, entryFile: plugin.entryFile, js });
    } catch (error) {
      bundles.push({
        dirName: plugin.dirName,
        entryFile: plugin.entryFile,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return bundles;
}
