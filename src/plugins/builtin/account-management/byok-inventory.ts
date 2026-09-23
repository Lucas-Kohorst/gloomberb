import { readProcessEnv } from "../../../utils/process-env";
import { getSharedRegistry } from "../../registry";
import { AI_BYOK_SERVICE_IDS, OLLAMA_BYOK_SERVICE_ID, byokKeysConfigSelector } from "./ai-providers";
import { getByokKnownServices } from "../byok/services";
import { canonicalByokServiceId, normalizeByokServiceKey } from "../byok/store";
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

function serviceGroupKey(service: ByokKnownService): string {
  return normalizeByokServiceKey(service.name) || normalizeByokServiceKey(service.id);
}

/** Prefer the id plugins call, then an id that already normalizes to that name. */
function pickCanonicalService(group: readonly ByokKnownService[]): ByokKnownService {
  const normalized = serviceGroupKey(group[0]!);
  return group.find((service) => service.id === normalized)
    ?? group.find((service) => normalizeByokServiceKey(service.id) === normalized)
    ?? group[0]!;
}

function keyFillsService(entry: ByokApiKeyEntry, group: readonly ByokKnownService[]): boolean {
  if (!entry.apiKey.trim()) return false;
  const targets = new Set(group.map((service) => canonicalByokServiceId(service.id, service.name, service.apiUrl)));
  const attached = canonicalByokServiceId(entry.serviceId, entry.name, entry.apiUrl);
  if (targets.has(attached) || targets.has(entry.serviceId)) return true;
  const labels = new Set(group.flatMap((service) => [
    normalizeByokServiceKey(service.id),
    normalizeByokServiceKey(service.name),
  ]));
  return labels.has(normalizeByokServiceKey(entry.serviceId))
    || labels.has(normalizeByokServiceKey(entry.name));
}

/**
 * One row per service. A saved key whose id, name, or host is that service
 * fills the catalog slot. An alias registration is not a second "Needs key" row.
 */
export function resolvePluginByokInventory(byokKeys: readonly ByokApiKeyEntry[]): PluginByokRow[] {
  const groups = new Map<string, ByokKnownService[]>();
  for (const service of listDiscoverableByokServices()) {
    const key = serviceGroupKey(service);
    const group = groups.get(key);
    if (group) group.push(service);
    else groups.set(key, [service]);
  }
  const registry = getSharedRegistry();
  const rows: PluginByokRow[] = [];
  for (const group of groups.values()) {
    const service = pickCanonicalService(group);
    const entry = byokKeys.find((candidate) => keyFillsService(candidate, group));
    const env = !entry && group.some((candidate) => envHasKey(candidate));
    const hasKey = Boolean(entry) || env;
    const pluginName = service.pluginId
      ? registry?.allPlugins.get(service.pluginId)?.name
      : undefined;
    rows.push({
      id: service.id,
      name: service.name,
      pluginId: service.pluginId,
      pluginName,
      description: service.description,
      envVar: service.envVar ?? group.find((candidate) => candidate.envVar)?.envVar,
      status: entry ? "attached" : env ? "env" : "missing",
      source: entry ? "stored" : env ? "env" : "none",
      hasKey,
    });
  }
  return rows;
}

export function pluginByokStatusLabel(status: PluginByokStatus): string {
  switch (status) {
    case "attached": return "Attached";
    case "env": return "Env";
    case "missing": return "Needs key";
  }
}

export { byokKeysConfigSelector };
