import { readProcessEnv } from "../../../utils/process-env";
import { getSharedRegistry } from "../../registry";
import { AI_BYOK_SERVICE_IDS, OLLAMA_BYOK_SERVICE_ID, byokKeysConfigSelector } from "./ai-providers";
import { getByokKnownServices } from "../byok/services";
import type { ByokApiKeyEntry, ByokKnownService } from "../byok/types";

const AI_SERVICE_IDS = new Set<string>([...AI_BYOK_SERVICE_IDS, OLLAMA_BYOK_SERVICE_ID]);

export type PluginByokStatus = "attached" | "env" | "missing";

export interface PluginByokRow {
  id: string;
  name: string;
  pluginId?: string;
  pluginName?: string;
  description: string;
  envVar?: string;
  status: PluginByokStatus;
  source: "stored" | "env" | "none";
  hasKey: boolean;
}

function envHasKey(service: ByokKnownService): boolean {
  const name = service.envVar?.trim();
  if (!name) return false;
  return Boolean(readProcessEnv(name));
}

export function listDiscoverableByokServices(): ByokKnownService[] {
  return getByokKnownServices().filter((service) => !AI_SERVICE_IDS.has(service.id));
}

export function resolvePluginByokInventory(byokKeys: readonly ByokApiKeyEntry[]): PluginByokRow[] {
  const stored = new Map(byokKeys.map((entry) => [entry.serviceId, entry]));
  const registry = getSharedRegistry();
  return listDiscoverableByokServices().map((service) => {
    const entry = stored.get(service.id);
    const env = !entry?.apiKey?.trim() && envHasKey(service);
    const hasKey = Boolean(entry?.apiKey?.trim()) || env;
    const pluginName = service.pluginId
      ? registry?.allPlugins.get(service.pluginId)?.name
      : undefined;
    return {
      id: service.id,
      name: service.name,
      pluginId: service.pluginId,
      pluginName,
      description: service.description,
      envVar: service.envVar,
      status: entry?.apiKey?.trim() ? "attached" : env ? "env" : "missing",
      source: entry?.apiKey?.trim() ? "stored" : env ? "env" : "none",
      hasKey,
    };
  });
}

export function pluginByokStatusLabel(status: PluginByokStatus): string {
  switch (status) {
    case "attached": return "Attached";
    case "env": return "Env";
    case "missing": return "Needs key";
  }
}

export { byokKeysConfigSelector };
