/**
 * Severe-weather source adapters and registry.
 *
 * Each adapter maps one {@link SevereWeatherEventKind} to a public agency that
 * publishes the authoritative record:
 *
 * - Hurricane / tropical cyclone → NHC (National Hurricane Center)
 * - Tornado → SPC (Storm Prediction Center)
 * - Drought → US Drought Monitor (NDMC / USDA / NOAA)
 * - Wildfire → NIFC (National Interagency Fire Center)
 *
 * A market is only {@link SevereWeatherSourceStatus.Supported} when its rules
 * explicitly name the public source. Otherwise the adapter returns
 * {@link SevereWeatherSourceStatus.Manual} — the integrator must verify
 * settlement by hand rather than guessing.
 */

import { classifySevereWeatherKind } from "./classify";
import type {
  SevereWeatherEventKind,
  SevereWeatherMarketHints,
  SevereWeatherSourceAdapter,
  SevereWeatherSourceResult,
} from "./types";

function joinRules(hints: SevereWeatherMarketHints): string {
  return [
    hints.resolutionSource,
    hints.rulesPrimary,
    hints.rulesSecondary,
  ].filter((value): value is string => !!value && value.trim().length > 0).join("\n");
}

function hasPhrase(text: string, phrase: string): boolean {
  const lower = text.toLowerCase();
  if (lower.includes(phrase.toLowerCase())) return true;
  const pattern = phrase
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/[\s.-]+/g, "[\\s.-]+");
  return new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`, "i").test(text);
}

function hasAnyPhrase(text: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => hasPhrase(text, phrase));
}

// ---------------------------------------------------------------------------
// NHC — National Hurricane Center
// ---------------------------------------------------------------------------

const NHC_ADAPTER: SevereWeatherSourceAdapter = {
  kind: "hurricane",
  label: "Hurricane / Tropical Cyclone",
  keywords: [],
  sourceIdentifiers: [
    "nhc",
    "national hurricane center",
    "nhc.noaa.gov",
    "noaa",
    "national oceanic and atmospheric administration",
    "best track",
    "hurdat",
    "tropical cyclone report",
    "public advisory",
    "nhc public advisory",
  ],
  sourceName: "NHC",
  sourceUrl: "https://www.nhc.noaa.gov/",
  dataUrl: "https://www.nhc.noaa.gov/CurrentStorms.json",
  resolve(hints: SevereWeatherMarketHints): SevereWeatherSourceResult {
    const rules = joinRules(hints);
    if (hasAnyPhrase(rules, NHC_ADAPTER.sourceIdentifiers)) {
      return {
        kind: "hurricane",
        status: "supported",
        source: NHC_ADAPTER.sourceName,
        sourceUrl: NHC_ADAPTER.sourceUrl,
        dataUrl: NHC_ADAPTER.dataUrl,
        description:
          "Settles per the National Hurricane Center (NHC) best track / tropical cyclone report.",
        reason: "Rules name the NHC / NOAA as the resolution source.",
      };
    }
    return {
      kind: "hurricane",
      status: "manual",
      source: null,
      sourceUrl: null,
      dataUrl: null,
      description:
        "Hurricane market, but the rules do not name a public source. Verify settlement manually.",
      reason: "No public source (NHC / NOAA) named in the rules.",
    };
  },
};

// ---------------------------------------------------------------------------
// SPC — Storm Prediction Center
// ---------------------------------------------------------------------------

const SPC_ADAPTER: SevereWeatherSourceAdapter = {
  kind: "tornado",
  label: "Tornado / Severe Thunderstorm",
  keywords: [],
  sourceIdentifiers: [
    "spc",
    "storm prediction center",
    "spc.noaa.gov",
    "noaa",
    "national oceanic and atmospheric administration",
    "spc storm reports",
    "storm reports",
    "spc tornado count",
    "noaa storm prediction center",
  ],
  sourceName: "SPC",
  sourceUrl: "https://www.spc.noaa.gov/",
  dataUrl: "https://www.spc.noaa.gov/climo/online/monthly/tornmonth.php",
  resolve(hints: SevereWeatherMarketHints): SevereWeatherSourceResult {
    const rules = joinRules(hints);
    if (hasAnyPhrase(rules, SPC_ADAPTER.sourceIdentifiers)) {
      return {
        kind: "tornado",
        status: "supported",
        source: SPC_ADAPTER.sourceName,
        sourceUrl: SPC_ADAPTER.sourceUrl,
        dataUrl: SPC_ADAPTER.dataUrl,
        description:
          "Settles per the NOAA Storm Prediction Center (SPC) storm reports.",
        reason: "Rules name the SPC / NOAA as the resolution source.",
      };
    }
    return {
      kind: "tornado",
      status: "manual",
      source: null,
      sourceUrl: null,
      dataUrl: null,
      description:
        "Tornado market, but the rules do not name a public source. Verify settlement manually.",
      reason: "No public source (SPC / NOAA) named in the rules.",
    };
  },
};

// ---------------------------------------------------------------------------
// US Drought Monitor
// ---------------------------------------------------------------------------

const DROUGHT_ADAPTER: SevereWeatherSourceAdapter = {
  kind: "drought",
  label: "Drought",
  keywords: [],
  sourceIdentifiers: [
    "drought monitor",
    "us drought monitor",
    "u.s. drought monitor",
    "droughtmonitor.unl.edu",
    "ndmc",
    "national drought mitigation center",
    "usdm",
    "drought monitor map",
    "united states drought monitor",
  ],
  sourceName: "US Drought Monitor",
  sourceUrl: "https://droughtmonitor.unl.edu/",
  dataUrl: "https://droughtmonitor.unl.edu/DmData/DataDownload.aspx",
  resolve(hints: SevereWeatherMarketHints): SevereWeatherSourceResult {
    const rules = joinRules(hints);
    if (hasAnyPhrase(rules, DROUGHT_ADAPTER.sourceIdentifiers)) {
      return {
        kind: "drought",
        status: "supported",
        source: DROUGHT_ADAPTER.sourceName,
        sourceUrl: DROUGHT_ADAPTER.sourceUrl,
        dataUrl: DROUGHT_ADAPTER.dataUrl,
        description:
          "Settles per the US Drought Monitor (NDMC / USDA / NOAA) weekly map.",
        reason: "Rules name the US Drought Monitor as the resolution source.",
      };
    }
    return {
      kind: "drought",
      status: "manual",
      source: null,
      sourceUrl: null,
      dataUrl: null,
      description:
        "Drought market, but the rules do not name a public source. Verify settlement manually.",
      reason: "No public source (US Drought Monitor) named in the rules.",
    };
  },
};

// ---------------------------------------------------------------------------
// NIFC — National Interagency Fire Center
// ---------------------------------------------------------------------------

const NIFC_ADAPTER: SevereWeatherSourceAdapter = {
  kind: "wildfire",
  label: "Wildfire",
  keywords: [],
  sourceIdentifiers: [
    "nifc",
    "national interagency fire center",
    "nifc.gov",
    "national fire situation report",
    "interagency fire",
    "national interagency coordination center",
    "nicc",
  ],
  sourceName: "NIFC",
  sourceUrl: "https://www.nifc.gov/",
  dataUrl: "https://www.nifc.gov/national-fire-news",
  resolve(hints: SevereWeatherMarketHints): SevereWeatherSourceResult {
    const rules = joinRules(hints);
    if (hasAnyPhrase(rules, NIFC_ADAPTER.sourceIdentifiers)) {
      return {
        kind: "wildfire",
        status: "supported",
        source: NIFC_ADAPTER.sourceName,
        sourceUrl: NIFC_ADAPTER.sourceUrl,
        dataUrl: NIFC_ADAPTER.dataUrl,
        description:
          "Settles per the National Interagency Fire Center (NIFC) situation reports.",
        reason: "Rules name the NIFC as the resolution source.",
      };
    }
    return {
      kind: "wildfire",
      status: "manual",
      source: null,
      sourceUrl: null,
      dataUrl: null,
      description:
        "Wildfire market, but the rules do not name a public source. Verify settlement manually.",
      reason: "No public source (NIFC) named in the rules.",
    };
  },
};

/** Ordered registry of severe-weather source adapters. */
export const SEVERE_WEATHER_SOURCE_REGISTRY: readonly SevereWeatherSourceAdapter[] = [
  NHC_ADAPTER,
  SPC_ADAPTER,
  DROUGHT_ADAPTER,
  NIFC_ADAPTER,
];

const ADAPTER_BY_KIND = new Map<SevereWeatherEventKind, SevereWeatherSourceAdapter>(
  SEVERE_WEATHER_SOURCE_REGISTRY.map((adapter) => [adapter.kind, adapter]),
);

/** Return the adapter for a given event kind, or `null` for "other". */
export function getSevereWeatherAdapter(
  kind: SevereWeatherEventKind,
): SevereWeatherSourceAdapter | null {
  return ADAPTER_BY_KIND.get(kind) ?? null;
}

/**
 * Resolve a prediction market to its severe-weather source.
 *
 * This is the main entry point for integrators. It:
 * 1. Classifies the event kind from market text.
 * 2. If the kind has an adapter, delegates to the adapter which checks whether
 *    the rules name a public source → `supported` or `manual`.
 * 3. If the kind is "other" (severe-weather language but no adapter), returns
 *    `manual` with an explanation.
 * 4. If no severe-weather kind is detected, returns `unrelated`.
 */
export function resolveSevereWeatherSource(
  hints: SevereWeatherMarketHints,
): SevereWeatherSourceResult {
  const kind = classifySevereWeatherKind(hints);
  if (!kind) {
    return {
      kind: "other",
      status: "unrelated",
      source: null,
      sourceUrl: null,
      dataUrl: null,
      description: "Not a severe-weather market.",
      reason: "No severe-weather keyword found in market text.",
    };
  }

  const adapter = getSevereWeatherAdapter(kind);
  if (adapter) return adapter.resolve(hints);

  // Severe-weather language was detected but we have no adapter for this kind.
  return {
    kind: "other",
    status: "manual",
    source: null,
    sourceUrl: null,
    dataUrl: null,
    description:
      "Severe-weather market, but no public source adapter is available for this event kind. Verify settlement manually.",
    reason: "Event kind detected but no adapter is registered for it.",
  };
}

// Re-export adapter constants for integrators that want direct access.
export {
  NHC_ADAPTER,
  SPC_ADAPTER,
  DROUGHT_ADAPTER,
  NIFC_ADAPTER,
};
