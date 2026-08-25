import type { KeyedDataProvider, ProviderPlan } from "./types";

function allowlistedProxy(options: {
  id: string;
  name: string;
  origin: string;
  ttlSeconds: number;
  userAgent: string;
  allowedKeyPath: (keyPath: string) => boolean;
  allowedSearchKeys?: readonly string[];
  extraHeaders?: Record<string, string>;
  unknownPathError?: string;
}): KeyedDataProvider {
  return {
    id: options.id,
    name: options.name,
    ttlSeconds: options.ttlSeconds,
    userAgent: options.userAgent,
    resolve({ keyPath, search }): ProviderPlan {
      if (!options.allowedKeyPath(keyPath)) {
        return {
          kind: "error",
          status: 404,
          error: options.unknownPathError ?? `Unknown ${options.name} path`,
        };
      }
      const params = new URLSearchParams();
      for (const key of options.allowedSearchKeys ?? []) {
        const value = search.get(key);
        if (value) params.set(key, value);
      }
      const query = params.size ? `?${params.toString()}` : "";
      return {
        kind: "proxy",
        url: `${options.origin}/${keyPath}${query}`,
        extraHeaders: options.extraHeaders,
      };
    },
  };
}

const WORLD_BANK_INDICATOR = /^v2\/country\/all\/indicator\/[A-Z0-9._]+$/i;
const OPENSKY_PATH = "api/states/all";
const DIGITRAFFIC_PATH = "api/ais/v1/locations";
const FIRMS_PATH = "data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv";
const GIBS_PATH = "wms/epsg4326/best/wms.cgi";
const GIBS_LAYERS = new Set([
  "MODIS_Terra_CorrectedReflectance_TrueColor",
  "VIIRS_SNPP_CorrectedReflectance_TrueColor",
  "HLS_S30_Nadir_BRDF_Adjusted_Reflectance",
  "VIIRS_NOAA20_Thermal_Anomalies_375m_All",
]);

export const worldBankProvider = allowlistedProxy({
  id: "world-bank",
  name: "World Bank",
  origin: "https://api.worldbank.org",
  ttlSeconds: 6 * 3600,
  userAgent: "gloomberb-world-bank",
  allowedKeyPath: (keyPath) => WORLD_BANK_INDICATOR.test(keyPath),
  allowedSearchKeys: ["format", "per_page", "mrnev"],
});

export const openskyProvider = allowlistedProxy({
  id: "opensky",
  name: "OpenSky Network",
  origin: "https://opensky-network.org",
  ttlSeconds: 15,
  userAgent: "gloomberb-traffic",
  allowedKeyPath: (keyPath) => keyPath === OPENSKY_PATH,
  allowedSearchKeys: ["lamin", "lomin", "lamax", "lomax"],
});

export const digitrafficAisProvider = allowlistedProxy({
  id: "digitraffic-ais",
  name: "Digitraffic AIS",
  origin: "https://meri.digitraffic.fi",
  ttlSeconds: 30,
  userAgent: "gloomberb-traffic",
  allowedKeyPath: (keyPath) => keyPath === DIGITRAFFIC_PATH,
});

export const nasaFirmsProvider = allowlistedProxy({
  id: "nasa-firms",
  name: "NASA FIRMS",
  origin: "https://firms.modaps.eosdis.nasa.gov",
  ttlSeconds: 900,
  userAgent: "gloomberb-satellite",
  allowedKeyPath: (keyPath) => keyPath === FIRMS_PATH,
});

export const nasaGibsProvider: KeyedDataProvider = {
  id: "nasa-gibs",
  name: "NASA GIBS",
  ttlSeconds: 3600,
  userAgent: "gloomberb-satellite",
  resolve({ keyPath, search }): ProviderPlan {
    if (keyPath !== GIBS_PATH) {
      return { kind: "error", status: 404, error: "Unknown NASA GIBS path" };
    }
    const layer = search.get("LAYERS") ?? "";
    if (!GIBS_LAYERS.has(layer)) {
      return { kind: "error", status: 404, error: "Unknown NASA GIBS layer" };
    }
    const params = new URLSearchParams();
    for (const key of ["SERVICE", "VERSION", "REQUEST", "LAYERS", "STYLES", "FORMAT", "TRANSPARENT", "WIDTH", "HEIGHT", "SRS", "BBOX", "TIME"]) {
      const value = search.get(key);
      if (value) params.set(key, value);
    }
    return {
      kind: "proxy",
      url: `https://gibs.earthdata.nasa.gov/${GIBS_PATH}?${params.toString()}`,
      extraHeaders: { Accept: "image/jpeg" },
    };
  },
};
