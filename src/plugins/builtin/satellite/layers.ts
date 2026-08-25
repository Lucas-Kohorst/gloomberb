import type { ImageryLayer } from "./types";

export const GIBS_LAYERS: ImageryLayer[] = [
  {
    id: "modis",
    label: "MODIS true color",
    layer: "MODIS_Terra_CorrectedReflectance_TrueColor",
  },
  {
    id: "viirs",
    label: "VIIRS true color",
    layer: "VIIRS_SNPP_CorrectedReflectance_TrueColor",
  },
  {
    id: "hls",
    label: "HLS Sentinel-like",
    layer: "HLS_S30_Nadir_BRDF_Adjusted_Reflectance",
  },
  {
    id: "fires",
    label: "Thermal anomalies",
    layer: "VIIRS_NOAA20_Thermal_Anomalies_375m_All",
  },
];

export const FIRMS_CSV_PATH =
  "data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv";

export function utcDateKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function gibsWmsUrl(layer: string, date: string, bbox = "-180,-90,180,90"): string {
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetMap",
    LAYERS: layer,
    STYLES: "",
    FORMAT: "image/jpeg",
    TRANSPARENT: "false",
    WIDTH: "1024",
    HEIGHT: "512",
    SRS: "EPSG:4326",
    BBOX: bbox,
    TIME: date,
  });
  return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${params.toString()}`;
}

export function gibsHostedPath(layer: string): string {
  return `wms/epsg4326/best/wms.cgi`;
}

export function gibsHostedSearch(layer: string, date: string, bbox = "-180,-90,180,90"): string {
  return new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetMap",
    LAYERS: layer,
    FORMAT: "image/jpeg",
    WIDTH: "1024",
    HEIGHT: "512",
    SRS: "EPSG:4326",
    BBOX: bbox,
    TIME: date,
  }).toString();
}
