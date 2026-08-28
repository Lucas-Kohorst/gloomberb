import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const LOCAL_DROID_PATH = join(homedir(), ".local", "bin", "droid");
export const FACTORY_AUTH_PATH = join(homedir(), ".factory", "auth.v2.file");
export const FACTORY_WORKDIR = join(homedir(), ".gloomberb", "plugins");

export function resolveDroidBinary(): string {
  return existsSync(LOCAL_DROID_PATH) ? LOCAL_DROID_PATH : "droid";
}

export function isFactoryCliAvailable(
  fileExists: (path: string) => boolean = existsSync,
): boolean {
  return fileExists(LOCAL_DROID_PATH) || fileExists(FACTORY_AUTH_PATH);
}
