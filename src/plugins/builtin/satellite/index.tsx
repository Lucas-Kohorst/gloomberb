import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, ImageSurface, Text, type InputRenderable } from "../../../ui";
import {
  DataTableStackView,
  EmptyState,
  InputSearchBar,
  Spinner,
  Tabs,
  type DataTableCell,
  type DataTableKeyEvent,
  type DataTableRootKeyContext,
  type PaneFooterSegment,
} from "../../../components";
import { useShortcut } from "../../../react/input";
import { colors } from "../../../theme/colors";
import { isPlainKey } from "../../../utils/keyboard";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import type { GloomPlugin, PaneProps } from "../../../types/plugin";
import { registerConnectionSource } from "../connections/register";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import {
  paneRefreshHint,
  paneSearchHint,
  usePaneStatusLinkFooter,
} from "../shared/pane-footer";
import { imageryUrl, loadFirmsHotspots, prefetchGibs } from "./client";
import { GIBS_LAYERS, utcDateKey } from "./layers";
import {
  FIRE_ROW_CAP,
  buildFireColumns,
  DEFAULT_FIRE_SORT,
  nextFireSort,
  sortFireRows,
  type FireColumn,
  type FireSort,
} from "./model";
import { matchesHotspotSearch } from "./parse";
import {
  FIRMS_CONNECTION_ID,
  GIBS_CONNECTION_ID,
  SATELLITE_PANE_ID,
  SATELLITE_PLUGIN_ID,
  type FireHotspot,
  type LoadStatus,
  type SatelliteTab,
} from "./types";

function formatNum(value: number | null, digits = 1): string {
  return value == null ? "—" : value.toFixed(digits);
}

function renderFireCell(
  row: FireHotspot,
  column: FireColumn,
  selected: boolean,
): DataTableCell {
  const selectedColor = selected ? colors.selectedText : undefined;
  switch (column.id) {
    case "time":
      return { text: `${row.acqDate} ${row.acqTime}`, color: selectedColor ?? colors.text };
    case "lat":
      return { text: row.lat.toFixed(2), color: selectedColor ?? colors.textDim };
    case "lon":
      return { text: row.lon.toFixed(2), color: selectedColor ?? colors.textDim };
    case "frp":
      return { text: formatNum(row.frp), color: selectedColor ?? colors.textBright };
    case "bright":
      return { text: formatNum(row.brightness, 0), color: selectedColor ?? colors.text };
    case "sat":
      return { text: row.satellite, color: selectedColor ?? colors.textMuted };
  }
}

function HotspotDetail({ row, imageSrc }: { row: FireHotspot; imageSrc: string }) {
  const bbox = `${row.lon - 8},${row.lat - 4},${row.lon + 8},${row.lat + 4}`;
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} paddingTop={1} flexDirection="column">
        <Text fg={colors.textMuted}>{`${row.satellite} · FRP ${formatNum(row.frp)} · ${row.confidence}`}</Text>
      </Box>
      <ImageSurface src={imageSrc} alt="FIRMS region" objectFit="contain" flexGrow={1}>
        <Box flexGrow={1} />
      </ImageSurface>
      <Text fg={colors.textDim}>{bbox}</Text>
    </Box>
  );
}

function SatellitePane({ paneId, focused, width, height }: PaneProps) {
  const [tab, setTab] = useState<SatelliteTab>("fires");
  const [hotspots, setHotspots] = useState<FireHotspot[]>([]);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<FireSort>(DEFAULT_FIRE_SORT);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [layerId, setLayerId] = useState(GIBS_LAYERS[0]!.id);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const searchInputRef = useRef<InputRenderable | null>(null);
  const fetchGen = useRef(0);
  const date = utcDateKey();
  const layer = GIBS_LAYERS.find((entry) => entry.id === layerId) ?? GIBS_LAYERS[0]!;

  const loadFires = useCallback(async () => {
    fetchGen.current += 1;
    const gen = fetchGen.current;
    setStatus("loading");
    setError(null);
    try {
      const next = await loadFirmsHotspots();
      if (fetchGen.current !== gen) return;
      setHotspots(next);
      setStatus("loaded");
      setLastUpdated(Date.now());
    } catch (err) {
      if (fetchGen.current !== gen) return;
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void loadFires();
  }, [loadFires]);
  useAutoRefresh(lastUpdated, loadFires, 30);

  useEffect(() => {
    if (tab !== "imagery") return;
    void prefetchGibs(imageryUrl(layer.layer, date)).catch(() => {});
  }, [date, layer.layer, tab]);

  const visible = useMemo(() => {
    const matched = hotspots.filter((row) => matchesHotspotSearch(row, searchQuery));
    return sortFireRows(matched, sort).slice(0, FIRE_ROW_CAP);
  }, [hotspots, searchQuery, sort]);

  useEffect(() => {
    if (!selectedId || !visible.some((row) => row.id === selectedId)) {
      setSelectedId(visible[0]?.id ?? null);
    }
  }, [selectedId, visible]);

  const selected = visible.find((row) => row.id === selectedId) ?? null;
  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((current) => current + 1);
  }, []);

  const cycleLayer = useCallback(() => {
    const index = GIBS_LAYERS.findIndex((entry) => entry.id === layerId);
    setLayerId(GIBS_LAYERS[(index + 1) % GIBS_LAYERS.length]!.id);
  }, [layerId]);

  const handleRootKeyDown = useCallback((
    event: DataTableKeyEvent,
    context: DataTableRootKeyContext,
  ) => {
    if (context.selectedIndex <= 0 && isPlainArrowUp(event)) {
      stopSearchFocusNavigation(event);
      focusSearch();
      return true;
    }
    if (event.name === "s" || event.name === "/") {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
      return true;
    }
    return false;
  }, [focusSearch]);

  const selectedBbox = selected
    ? `${selected.lon - 8},${selected.lat - 4},${selected.lon + 8},${selected.lat + 4}`
    : "-180,-90,180,90";
  const imageSrc = imageryUrl(
    tab === "fires" ? "VIIRS_NOAA20_Thermal_Anomalies_375m_All" : layer.layer,
    date,
    tab === "fires" && selected ? selectedBbox : undefined,
  );

  const footerInfo = useMemo<PaneFooterSegment[]>(() => [
    ...(hotspots.length > 0 || tab === "imagery"
      ? [{ id: "delayed", parts: [{ text: "delayed", tone: "muted" as const }] }]
      : []),
    ...(tab === "imagery" ? [{ id: "layer", parts: [{ text: layer.label, tone: "muted" as const }] }] : []),
  ], [hotspots.length, layer.label, tab]);

  usePaneStatusLinkFooter({
    registrationId: paneId,
    focused,
    url: tab === "fires" ? selected?.url : "https://earthdata.nasa.gov/gibs",
    source: tab === "fires" ? "FIRMS" : "GIBS",
    label: tab === "fires" ? "hotspot" : "imagery",
    loading: status === "loading" && tab === "fires",
    error: tab === "fires" ? error : null,
    info: footerInfo,
    showOpenHint: tab === "fires" ? !!selected?.url : true,
    hints: [
      ...(tab === "fires" ? [paneSearchHint(focusSearch)] : []),
      paneRefreshHint(loadFires, { disabled: status === "loading" && hotspots.length === 0 }),
      ...(tab === "imagery"
        ? [{ id: "layer", key: "l", label: "ayer", onPress: cycleLayer }]
        : []),
    ],
  });

  useShortcut((event) => {
    if (!focused || searchFocused) return;
    if (tab === "fires" && (event.name === "s" || event.name === "/")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
    }
    if (tab === "imagery" && isPlainKey(event, "l")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      cycleLayer();
    }
  }, { enabled: focused && !searchFocused });

  const columns = useMemo(() => buildFireColumns(width), [width]);
  const tabs = (
    <Box height={1}>
      <Tabs
        tabs={[
          { label: "Fires", value: "fires" },
          { label: "Imagery", value: "imagery" },
        ]}
        activeValue={tab}
        onSelect={(value) => {
          setTab(value as SatelliteTab);
          setDetailOpen(false);
        }}
        compact
        variant="bare"
        focused={focused && !searchFocused && !detailOpen}
      />
    </Box>
  );

  if (tab === "imagery") {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        <Box paddingX={1} height={1}>
          <Text fg={colors.textMuted}>{date}</Text>
        </Box>
        <ImageSurface src={imageSrc} alt={layer.label} objectFit="contain" flexGrow={1}>
          <Box flexGrow={1} justifyContent="center" alignItems="center">
            <Text fg={colors.textDim}>NASA GIBS / HLS (Sentinel-like public imagery)</Text>
          </Box>
        </ImageSurface>
      </Box>
    );
  }

  if (status === "loading" && hotspots.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label="Loading FIRMS hotspots..." />
        </Box>
      </Box>
    );
  }

  if (error && hotspots.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height} padding={1}>
        {tabs}
        <EmptyState title="FIRMS unavailable." />
      </Box>
    );
  }

  return (
    <DataTableStackView<FireHotspot, FireColumn>
      focused={focused && !searchFocused}
      detailOpen={detailOpen && !!selected}
      onBack={() => setDetailOpen(false)}
      detailTitle={selected ? `${selected.lat.toFixed(2)}, ${selected.lon.toFixed(2)}` : undefined}
      detailContent={selected ? <HotspotDetail row={selected} imageSrc={imageSrc} /> : null}
      rootBefore={(
        <Box flexDirection="column">
          {tabs}
          <InputSearchBar
            value={searchQuery}
            focused={focused && !detailOpen}
            active={searchFocused}
            width={width}
            focusToken={searchFocusToken}
            inputRef={searchInputRef}
            placeholder="lat, satellite, date"
            debounceMs={80}
            onFocus={focusSearch}
            onBlur={() => setSearchFocused(false)}
            onNavigateDown={() => setSearchFocused(false)}
            onQueryChange={setSearchQuery}
          />
        </Box>
      )}
      selection={{
        kind: "id",
        selectedId,
        getId: (row) => row.id,
        onChange: setSelectedId,
      }}
      onActivate={(row) => {
        setSelectedId(row.id);
        setDetailOpen(true);
      }}
      rootWidth={width}
      rootHeight={height}
      columns={columns}
      items={visible}
      sortColumnId={sort.columnId}
      sortDirection={sort.direction}
      onHeaderClick={(columnId) => setSort((current) => nextFireSort(current, columnId as FireColumn["id"]))}
      getItemKey={(row) => row.id}
      renderCell={(row, column, _index, state) => renderFireCell(row, column, state.selected)}
      emptyStateTitle="No fire hotspots."
      onRootKeyDown={handleRootKeyDown}
    />
  );
}

let disposeFirms: (() => void) | null = null;
let disposeGibs: (() => void) | null = null;

export const satellitePlugin: GloomPlugin = {
  id: SATELLITE_PLUGIN_ID,
  name: "Satellite",
  version: "1.0.0",
  description:
    "NASA FIRMS fire hotspots and NASA GIBS / HLS imagery, a public substitute for Copernicus Browser.",
  toggleable: true,
  panes: [{
    id: SATELLITE_PANE_ID,
    name: "Satellite",
    icon: "I",
    component: SatellitePane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 96, height: 32 },
  }],
  paneTemplates: [{
    id: "satellite-pane",
    paneId: SATELLITE_PANE_ID,
    label: "Satellite",
    description:
      "NASA FIRMS VIIRS fire hotspots and NASA GIBS true-color / HLS (Sentinel-like) imagery. Public endpoints only. Search and sort hotspots; open the FIRMS map.",
    keywords: [
      "firms",
      "fire",
      "satellite",
      "copernicus",
      "sentinel",
      "gibs",
      "modis",
      "viirs",
      "imagery",
      "hotspot",
    ],
    category: "Data",
    shortcut: { prefix: "SAT" },
    createInstance: () => ({ placement: "floating" }),
  }],
  setup() {
    disposeFirms = registerConnectionSource({
      id: FIRMS_CONNECTION_ID,
      name: "NASA FIRMS",
      kind: "api",
      pluginId: SATELLITE_PLUGIN_ID,
      authRequired: false,
      priority: 370,
    });
    disposeGibs = registerConnectionSource({
      id: GIBS_CONNECTION_ID,
      name: "NASA GIBS",
      kind: "api",
      pluginId: SATELLITE_PLUGIN_ID,
      authRequired: false,
      priority: 371,
    });
  },
  dispose() {
    disposeFirms?.();
    disposeGibs?.();
    disposeFirms = null;
    disposeGibs = null;
  },
};
