import type { PluginTeamState, PluginTeamStateEntry } from "../types/plugin";

/**
 * What the cloud plugin installs so any plugin's `ctx.teamState` reaches the
 * team_plugin_state store. Kept behind a host so the registry never imports
 * cloud internals, the same way the marketplace host works.
 */
export interface TeamStateHost {
  activeTeamId(): string | null;
  get(teamId: string, pluginId: string, key: string): Promise<PluginTeamStateEntry<unknown> | null>;
  list(teamId: string, pluginId: string): Promise<Array<PluginTeamStateEntry<unknown> & { key: string }>>;
  set(
    teamId: string,
    pluginId: string,
    key: string,
    value: unknown,
    expectRevision: number | undefined,
  ): Promise<PluginTeamStateEntry<unknown>>;
  delete(teamId: string, pluginId: string, key: string): Promise<void>;
  subscribe(
    teamId: string,
    pluginId: string,
    key: string,
    listener: (entry: PluginTeamStateEntry<unknown> | null) => void,
  ): () => void;
}

let host: TeamStateHost | null = null;

export function setTeamStateHost(next: TeamStateHost | null): void {
  host = next;
}

function requireHost(): TeamStateHost {
  if (!host) throw new Error("Team state is not available: sign in to Gloom Cloud and join a team.");
  return host;
}

function requireTeam(teamId: string | undefined): string {
  const resolved = teamId ?? requireHost().activeTeamId();
  if (!resolved) throw new Error("No team is active. Pass a teamId or choose one with FOCUS.");
  return resolved;
}

export function createPluginTeamState(pluginId: string): PluginTeamState {
  return {
    activeTeamId: () => host?.activeTeamId() ?? null,
    async get(key, options) {
      const entry = await requireHost().get(requireTeam(options?.teamId), pluginId, key);
      return entry as never;
    },
    async list(options) {
      const entries = await requireHost().list(requireTeam(options?.teamId), pluginId);
      return entries as never;
    },
    async set(key, value, options) {
      const entry = await requireHost().set(requireTeam(options?.teamId), pluginId, key, value, options?.expectRevision);
      return { revision: entry.revision };
    },
    async delete(key, options) {
      await requireHost().delete(requireTeam(options?.teamId), pluginId, key);
    },
    subscribe(key, listener, options) {
      if (!host) return () => {};
      const teamId = options?.teamId ?? host.activeTeamId();
      if (!teamId) return () => {};
      return host.subscribe(teamId, pluginId, key, listener as never);
    },
  };
}
