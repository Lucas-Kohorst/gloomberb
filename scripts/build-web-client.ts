import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import {
  electrobunViewPath,
  writeSharePage,
  writeWebClientPage,
} from "../src/renderers/electrobun/view/build-assets";

const outdir = join(process.cwd(), "dist", "web-client");
const hosted = process.env.GLOOMBERB_CLOUD_HOSTED === "1";
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await writeFile(join(outdir, ".assetsignore"), "*.map\n");

await writeWebClientPage({
  entrypoint: electrobunViewPath("web-main.tsx"),
  outdir,
  sessionToken: process.env.GLOOMBERB_WEB_SESSION_TOKEN || randomUUID(),
  failureMessage: "Failed to build local web client assets",
  missingEntryMessage: "Local web client build did not produce a JavaScript entrypoint",
  title: "Gloomberb",
  loadingText: "Loading Gloomberb...",
  bootstrapScript: hosted ? "window.__GLOOM_CLOUD_HOSTED = true;" : "",
});

await writeSharePage({
  outdir,
  title: "Gloomberb",
  loadingText: "Loading shared view...",
});
