import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, TextAttributes, type InputRenderable } from "../../../ui";
import {
  DataTableStackView,
  dataErrorMessage,
  EmptyState,
  InputSearchBar,
  Spinner,
  Tabs,
  unavailableTitle,
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
  paneDelayedStatus,
  paneRefreshHint,
  paneSearchHint,
  usePaneStatusLinkFooter,
} from "../shared/pane-footer";
import { DEFAULT_BBOX_ID, TRAFFIC_BBOXES, findBbox } from "./bbox";
import { loadTraffic } from "./client";
import {
  TRAFFIC_ROW_CAP,
  buildTrafficColumns,
  DEFAULT_TRAFFIC_SORT,
  nextTrafficSort,
  sortTrafficRows,
  type TrafficColumn,
  type TrafficSort,
} from "./model";
import { matchesTrafficSearch, mergeTrafficVehicles } from "./parse";
import {
  DIGITRAFFIC_CONNECTION_ID,
  OPENSKY_CONNECTION_ID,
  TRAFFIC_PANE_ID,
  TRAFFIC_PLUGIN_ID,
  type LoadStatus,
  type TrafficKind,
  type TrafficVehicle,
} from "./types";

function formatCoord(value: number): string {
  return value.toFixed(2);
}

function formatAlt(row: TrafficVehicle): string {
  if (row.kind === "ship") {
    return row.heading == null ? "—" : `${Math.round(row.heading)}°`;
  }
  if (row.altitudeM == null) return row.onGround ? "gnd" : "—";
  return `${Math.round(row.altitudeM)}m`;
}

function formatSpeed(row: TrafficVehicle): string {
  if (row.speedMs == null) return "—";
  if (row.kind === "ship") return `${(row.speedMs * 1.94384).toFixed(1)}kt`;
  return `${Math.round(row.speedMs)}m/s`;
}

function renderCell(
  row: TrafficVehicle,
  column: TrafficColumn,
  selected: boolean,
): DataTableCell {
  const selectedColor = selected ? colors.selectedText : undefined;
  switch (column.id) {
    case "callsign":
      return { text: row.callsign, color: selectedColor ?? colors.textBright, attributes: TextAttributes.BOLD };
    case "country":
      return { text: row.country, color: selectedColor ?? colors.text };
    case "lat":
      return { text: formatCoord(row.lat), color: selectedColor ?? colors.textDim };
    case "lon":
      return { text: formatCoord(row.lon), color: selectedColor ?? colors.textDim };
    case "alt":
      return { text: formatAlt(row), color: selectedColor ?? colors.text };
    case "speed":
      return { text: formatSpeed(row), color: selectedColor ?? colors.text };
  }
}

function VehicleDetail({ vehicle }: { vehicle: TrafficVehicle }) {
  return (
    <Box flexDirection="column" padding={1} gap={0}>
      <Text fg={colors.textMuted}>{`${vehicle.source} · ${vehicle.kind}`}</Text>
      <Text fg={colors.text}>{`${vehicle.lat.toFixed(4)}, ${vehicle.lon.toFixed(4)}`}</Text>
      <Text fg={colors.text}>{`alt/hdg ${formatAlt(vehicle)} · ${formatSpeed(vehicle)}`}</Text>
      {vehicle.onGround ? <Text fg={colors.textDim}>on ground</Text> : null}
    </Box>
  );
}

function TrafficPane({ paneId, focused, width, height }: PaneProps) {
  const [kind, setKind] = useState<TrafficKind>("aircraft");
  const [bboxId, setBboxId] = useState(DEFAULT_BBOX_ID);
  const [vehicles, setVehicles] = useState<TrafficVehicle[]>([]);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<TrafficSort>(DEFAULT_TRAFFIC_SORT);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const searchInputRef = useRef<InputRenderable | null>(null);
  const fetchGen = useRef(0);

  const load = useCallback(async () => {
    fetchGen.current += 1;
    const gen = fetchGen.current;
    setStatus("loading");
    setError(null);
    try {
      const next = await loadTraffic(kind, bboxId, {
        onPartial: (partial) => {
          if (fetchGen.current !== gen) return;
          setVehicles((current) => mergeTrafficVehicles(current, partial));
          setStatus("loaded");
          setLastUpdated(Date.now());
        },
      });
      if (fetchGen.current !== gen) return;
      setVehicles((current) => mergeTrafficVehicles(current, next));
      setStatus("loaded");
      setLastUpdated(Date.now());
    } catch (err) {
      if (fetchGen.current !== gen) return;
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, [bboxId, kind]);

  useEffect(() => {
    void load();
  }, [load]);
  useAutoRefresh(lastUpdated, load, kind === "aircraft" ? 1 : 2);

  const visible = useMemo(() => {
    const matched = searchQuery.trim()
      ? vehicles.filter((row) => matchesTrafficSearch(row, searchQuery))
      : vehicles;
    const sorted = sortTrafficRows(matched, sort);
    return sorted.length > TRAFFIC_ROW_CAP ? sorted.slice(0, TRAFFIC_ROW_CAP) : sorted;
  }, [searchQuery, sort, vehicles]);

  const getRowRevision = useCallback(
    (row: TrafficVehicle) =>
      `${row.id}:${row.lat.toFixed(3)}:${row.lon.toFixed(3)}:${row.altitudeM ?? ""}:${row.speedMs ?? ""}:${row.callsign}`,
    [],
  );

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

  const cycleBbox = useCallback(() => {
    const index = TRAFFIC_BBOXES.findIndex((entry) => entry.id === bboxId);
    const next = TRAFFIC_BBOXES[(index + 1) % TRAFFIC_BBOXES.length]!;
    setBboxId(next.id);
  }, [bboxId]);

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
    if (isPlainKey(event, "b") && kind === "aircraft") {
      event.preventDefault?.();
      event.stopPropagation?.();
      cycleBbox();
      return true;
    }
    return false;
  }, [cycleBbox, focusSearch, kind]);

  const bbox = findBbox(bboxId);
  const footerInfo = useMemo<PaneFooterSegment[]>(() => [
    ...(kind === "aircraft" ? [{ id: "bbox", parts: [{ text: bbox.label, tone: "muted" as const }] }] : []),
    ...(vehicles.length > 0 ? [paneDelayedStatus()] : []),
  ], [bbox.label, kind, vehicles.length]);

  usePaneStatusLinkFooter({
    registrationId: paneId,
    focused,
    url: selected?.url,
    source: selected?.source,
    label: selected?.kind,
    loading: status === "loading",
    error,
    info: footerInfo,
    showOpenHint: !!selected?.url,
    hints: [
      paneSearchHint(focusSearch),
      paneRefreshHint(load, { disabled: status === "loading" && vehicles.length === 0 }),
      ...(kind === "aircraft"
        ? [{ id: "bbox", key: "b", label: "box", onPress: cycleBbox }]
        : []),
    ],
  });

  useShortcut((event) => {
    if (!focused || searchFocused) return;
    if (event.name === "s" || event.name === "/") {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
    }
  }, { enabled: focused && !searchFocused });

  const columns = useMemo(() => buildTrafficColumns(width, kind), [kind, width]);
  const tabs = (
    <Box height={1}>
      <Tabs
        tabs={[
          { label: "Aircraft", value: "aircraft" },
          { label: "Ships", value: "ship" },
        ]}
        activeValue={kind}
        onSelect={(value) => {
          setKind(value as TrafficKind);
          setDetailOpen(false);
        }}
        compact
        variant="bare"
        focused={focused && !searchFocused && !detailOpen}
      />
    </Box>
  );

  if (status === "loading" && vehicles.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label={kind === "aircraft" ? "Loading OpenSky..." : "Loading AIS..."} />
        </Box>
      </Box>
    );
  }

  if (error && vehicles.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height} padding={1}>
        {tabs}
        <EmptyState
          title={unavailableTitle(kind === "aircraft" ? "OpenSky" : "AIS")}
          message={dataErrorMessage(error)}
        />
      </Box>
    );
  }

  return (
    <DataTableStackView<TrafficVehicle, TrafficColumn>
      focused={focused && !searchFocused}
      detailOpen={detailOpen && !!selected}
      onBack={() => setDetailOpen(false)}
      detailTitle={selected?.callsign}
      detailContent={selected ? <VehicleDetail vehicle={selected} /> : null}
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
            placeholder={kind === "aircraft" ? "callsign or country" : "name or MMSI"}
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
      onHeaderClick={(columnId) => setSort((current) => nextTrafficSort(current, columnId as TrafficColumn["id"]))}
      getItemKey={(row) => row.id}
      getRowRevision={getRowRevision}
      renderCell={(row, column, _index, state) => renderCell(row, column, state.selected)}
      emptyStateTitle={kind === "ship" ? "No public AIS positions." : "No aircraft in this box."}
      onRootKeyDown={handleRootKeyDown}
    />
  );
}

let disposeOpensky: (() => void) | null = null;
let disposeAis: (() => void) | null = null;

export const trafficPlugin: GloomPlugin = {
  id: TRAFFIC_PLUGIN_ID,
  name: "Air & Sea Traffic",
  version: "1.0.0",
  description:
    "Delayed OpenSky aircraft and public Digitraffic AIS ship positions for research overlays. Not Flightradar24 or MarineTraffic.",
  toggleable: true,
  panes: [{
    id: TRAFFIC_PANE_ID,
    name: "Traffic",
    icon: "T",
    component: TrafficPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 92, height: 30 },
  }],
  paneTemplates: [{
    id: "traffic-pane",
    paneId: TRAFFIC_PANE_ID,
    label: "Air & Sea Traffic",
    description:
      "Delayed OpenSky aircraft and Finnish Digitraffic AIS ships. Legal public substitutes for Flightradar24 / MarineTraffic. Search, sort, and open the source record.",
    keywords: [
      "flight",
      "flightradar",
      "opensky",
      "ais",
      "ship",
      "marine",
      "osint",
      "traffic",
      "aircraft",
    ],
    category: "Data",
    shortcut: { prefix: "AIS" },
    createInstance: () => ({ placement: "floating" }),
  }],
  setup() {
    disposeOpensky = registerConnectionSource({
      id: OPENSKY_CONNECTION_ID,
      name: "OpenSky Network",
      kind: "api",
      pluginId: TRAFFIC_PLUGIN_ID,
      authRequired: false,
      priority: 360,
    });
    disposeAis = registerConnectionSource({
      id: DIGITRAFFIC_CONNECTION_ID,
      name: "Digitraffic AIS",
      kind: "api",
      pluginId: TRAFFIC_PLUGIN_ID,
      authRequired: false,
      priority: 361,
    });
  },
  dispose() {
    disposeOpensky?.();
    disposeAis?.();
    disposeOpensky = null;
    disposeAis = null;
  },
};
