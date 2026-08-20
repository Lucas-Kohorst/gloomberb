const BUILTIN_PLUGIN_OWNER_ALIASES: Record<string, string> = {
  analytics: "portfolio",
  "broker-manager": "broker",
  byok: "application",
  changelog: "application",
  connections: "application",
  "company-research": "ticker-research",
  "chart-composer": "ticker-research",
  "comparison-chart": "ticker-research",
  correlation: "market-overview",
  "credit-conditions": "macro",
  "bond-search": "macro",
  "dividend-yield": "ticker-research",
  "earnings-calendar": "macro",
  "fear-greed": "market-overview",
  "fx-matrix": "market-overview",
  help: "application",
  holders: "ticker-research",
  insider: "ticker-research",
  "ipo-calendar": "macro",
  "kelly-sizer": "portfolio",
  "layout-manager": "application",
  "macro-tv": "macro",
  "market-halts": "market-overview",
  "market-heatmap": "market-overview",
  "market-movers": "market-overview",
  options: "ticker-research",
  "options-calc": "portfolio",
  "portfolio-list": "portfolio",
  research: "ticker-research",
  scanner: "market-overview",
  sectors: "market-overview",
  sec: "ticker-research",
  "short-interest": "ticker-research",
  thirteenf: "ticker-research",
  "ticker-detail": "ticker-research",
  "treasury-auctions": "macro",
  volatility: "macro",
  "world-indices": "market-overview",
  polls: "adjacent",
  "llm-stats": "adjacent",
  weather: "adjacent",
};

const NON_TOGGLEABLE_BUILTIN_PLUGIN_IDS = new Set([
  "application",
  "changelog",
  "help",
  "layout-manager",
]);

const LEGACY_MODULE_IDS_BY_OWNER: Record<string, readonly string[]> = {
  application: ["layout-manager", "help", "changelog", "byok", "connections"],
  portfolio: ["portfolio-list", "analytics", "kelly-sizer", "options-calc"],
  "ticker-research": ["short-interest", "dividend-yield"],
  "market-overview": ["market-halts", "scanner"],
  macro: ["ipo-calendar", "treasury-auctions", "volatility", "bond-search", "credit-conditions"],
  adjacent: ["polls", "llm-stats", "weather"],
};

export function normalizeBuiltinPluginOwnerId(pluginId: string): string {
  return BUILTIN_PLUGIN_OWNER_ALIASES[pluginId] ?? pluginId;
}

export function isReservedBuiltinPluginId(pluginId: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUILTIN_PLUGIN_OWNER_ALIASES, pluginId);
}

export function isNonToggleableBuiltinPluginId(pluginId: string): boolean {
  return NON_TOGGLEABLE_BUILTIN_PLUGIN_IDS.has(pluginId);
}

export function normalizeBuiltinDisabledPluginIds(pluginIds: readonly string[]): string[] {
  return [...new Set(
    pluginIds
      .filter((pluginId) => !isNonToggleableBuiltinPluginId(pluginId))
      .map(normalizeBuiltinPluginOwnerId)
      .filter((pluginId) => !isNonToggleableBuiltinPluginId(pluginId)),
  )];
}

export function normalizeBuiltinPluginStateMap(
  value: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const remapped = Object.fromEntries(
    Object.entries(value).reduce<Array<[string, Record<string, unknown>]>>((entries, [pluginId, state]) => {
      const normalizedPluginId = normalizeBuiltinPluginOwnerId(pluginId);
      const existing = entries.find(([entryPluginId]) => entryPluginId === normalizedPluginId);
      if (existing) {
        existing[1] = pluginId === normalizedPluginId
          ? { ...existing[1], ...state }
          : { ...state, ...existing[1] };
      } else {
        entries.push([normalizedPluginId, { ...state }]);
      }
      return entries;
    }, []),
  );
  return liftAdjacentConfigFromCloud(remapped);
}

/**
 * Adjacent used to live under the Gloom Cloud composite. Lift its API key into
 * the adjacent plugin namespace so saved keys survive the extraction.
 */
function liftAdjacentConfigFromCloud(
  value: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const cloud = value["gloomberb-cloud"];
  if (!cloud || !Object.prototype.hasOwnProperty.call(cloud, "adjacentApiKey")) {
    return value;
  }
  const { adjacentApiKey, ...cloudRest } = cloud;
  const adjacent = { ...(value.adjacent ?? {}) };
  if (!Object.prototype.hasOwnProperty.call(adjacent, "adjacentApiKey")) {
    adjacent.adjacentApiKey = adjacentApiKey;
  }
  return {
    ...value,
    "gloomberb-cloud": cloudRest,
    adjacent,
  };
}

/**
 * Keeps config snapshots readable by clients from before built-in modules were
 * consolidated. Current clients normalize these aliases back to their owner.
 */
export function addLegacyBuiltinPluginOwnerAliases(
  value: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const output = Object.fromEntries(
    Object.entries(value).map(([pluginId, state]) => [pluginId, { ...state }]),
  );
  for (const [ownerId, legacyIds] of Object.entries(LEGACY_MODULE_IDS_BY_OWNER)) {
    const ownerState = value[ownerId];
    if (!ownerState) continue;
    for (const legacyId of legacyIds) {
      output[legacyId] ??= { ...ownerState };
    }
  }
  return output;
}

export function addLegacyBuiltinDisabledPluginAliases(pluginIds: readonly string[]): string[] {
  const output = new Set(pluginIds);
  for (const pluginId of pluginIds) {
    for (const legacyId of LEGACY_MODULE_IDS_BY_OWNER[pluginId] ?? []) {
      output.add(legacyId);
    }
  }
  return [...output];
}

function isPluginStateMap(value: unknown): value is Record<string, Record<string, unknown>> {
  return !!value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.values(value).every((entry) => !!entry && typeof entry === "object" && !Array.isArray(entry));
}

export function normalizeBuiltinPaneStatePluginOwners(
  paneState: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(paneState).map(([paneId, state]) => [
      paneId,
      isPluginStateMap(state.pluginState)
        ? { ...state, pluginState: normalizeBuiltinPluginStateMap(state.pluginState) }
        : state,
    ]),
  );
}

export function addLegacyBuiltinPaneStatePluginAliases(
  paneState: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(paneState).map(([paneId, state]) => [
      paneId,
      isPluginStateMap(state.pluginState)
        ? { ...state, pluginState: addLegacyBuiltinPluginOwnerAliases(state.pluginState) }
        : state,
    ]),
  );
}
