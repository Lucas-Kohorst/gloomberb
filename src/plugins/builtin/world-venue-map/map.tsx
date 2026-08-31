import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { CloudWorldVenuePayload } from "../../../api-client";
import { Box, ChartSurface, Text, useUiHost } from "../../../ui";
import { useThemeColors } from "../../../theme/theme-context";
import { getLocalPlotPointer, type ChartMouseEvent } from "../../../components/chart/core/pointer";
import {
  closestWorldVenueCluster,
  clusterWorldVenues,
  DEFAULT_WORLD_MAP_VIEWPORT,
  panWorldMapViewport,
  projectWorldPoint,
  worldMapTransform,
  zoomWorldMapViewport,
  type WorldMapPoint,
  type WorldMapViewport,
  type WorldVenueCluster,
} from "./model";
import { WORLD_OUTLINES } from "./world-outlines";

export interface WorldVenueMapProps {
  venues: readonly CloudWorldVenuePayload[];
  selectedMic: string | null;
  width: number;
  height: number;
  onSelect: (venue: CloudWorldVenuePayload) => void;
}

function clusterVenue(cluster: WorldVenueCluster, selectedMic: string | null): CloudWorldVenuePayload {
  return cluster.venues.find((venue) => venue.mic === selectedMic)
    ?? cluster.venues.find((venue) => venue.isOpen)
    ?? cluster.venues[0]!;
}

function isSelectedCluster(cluster: WorldVenueCluster, selectedMic: string | null): boolean {
  return cluster.venues.some((venue) => venue.mic === selectedMic);
}

function renderAsciiMap(
  venues: readonly CloudWorldVenuePayload[],
  selectedMic: string | null,
  width: number,
  height: number,
  cellAspect: number,
): string[] {
  const grid = Array.from({ length: Math.max(1, height) }, () => Array.from({ length: Math.max(1, width) }, () => " "));
  // Cell aspect squashes latitude hard, so plotting bare vertices leaves scattered
  // dots. Walking each coastline segment keeps the continents legible instead.
  const plotCoastline = (from: WorldMapPoint, to: WorldMapPoint) => {
    const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
    for (let step = 0; step <= steps; step += 1) {
      const progress = steps === 0 ? 0 : step / steps;
      const x = Math.round(from.x + (to.x - from.x) * progress);
      const y = Math.round(from.y + (to.y - from.y) * progress);
      if (grid[y]?.[x] === " ") grid[y]![x] = ".";
    }
  };
  for (const ring of WORLD_OUTLINES) {
    for (let index = 1; index < ring.length; index += 1) {
      const [previousLongitude, previousLatitude] = ring[index - 1]!;
      const [longitude, latitude] = ring[index]!;
      plotCoastline(
        projectWorldPoint(previousLongitude, previousLatitude, width, height, cellAspect),
        projectWorldPoint(longitude, latitude, width, height, cellAspect),
      );
    }
  }
  for (const cluster of clusterWorldVenues(venues, width, height, cellAspect)) {
    const x = Math.round(cluster.x);
    const y = Math.round(cluster.y);
    if (!grid[y]?.[x]) continue;
    grid[y]![x] = isSelectedCluster(cluster, selectedMic)
      ? "@"
      : cluster.venues.length > 1
        ? String(Math.min(cluster.venues.length, 9))
        : cluster.isOpen ? "O" : "o";
  }
  return grid.map((row) => row.join(""));
}

function TerminalWorldVenueMap(props: WorldVenueMapProps) {
  const colors = useThemeColors();
  const surfaceRef = useRef<unknown>(null);
  const cellAspect = 18 / 8;
  const clusters = useMemo(
    () => clusterWorldVenues(props.venues, props.width, props.height, cellAspect),
    [props.height, props.venues, props.width],
  );
  const ascii = useMemo(
    () => renderAsciiMap(props.venues, props.selectedMic, props.width, props.height, cellAspect),
    [props.height, props.selectedMic, props.venues, props.width],
  );

  const selectAt = (event: ChartMouseEvent) => {
    const pointer = getLocalPlotPointer(event, surfaceRef.current as Parameters<typeof getLocalPlotPointer>[1], {
      resolution: null,
      terminalWidth: 0,
      terminalHeight: 0,
    });
    if (!pointer) return;
    const cluster = closestWorldVenueCluster(clusters, pointer.cellX, pointer.cellY, 4);
    if (cluster) props.onSelect(clusterVenue(cluster, props.selectedMic));
  };

  return (
    <ChartSurface
      ref={surfaceRef}
      width={props.width}
      height={props.height}
      flexDirection="column"
      onMouseDown={selectAt}
      data-gloom-role="world-venue-map"
      aria-label="World venue map"
    >
      {ascii.map((line, index) => <Text key={index} fg={colors.textDim}>{line}</Text>)}
    </ChartSurface>
  );
}

const DESKTOP_MAP_ASPECT = 2.12;
const MAP_PAN_THRESHOLD_PX = 4;
const MAP_CLICK_HIT_PX = 14;
const MAP_DOUBLE_CLICK_ZOOM = 1.8;

function wheelZoomFactor(event: { deltaY: number; deltaMode: number }): number {
  const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
  return Math.exp(-delta * 0.002);
}

function clientToMapPoint(
  event: { clientX: number; clientY: number },
  element: { getBoundingClientRect: () => { left: number; top: number; width: number; height: number } },
  width: number,
  height: number,
): WorldMapPoint {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.width <= 0 ? 0 : ((event.clientX - rect.left) / rect.width) * width,
    y: rect.height <= 0 ? 0 : ((event.clientY - rect.top) / rect.height) * height,
  };
}

function clientDeltaToMapDelta(
  deltaX: number,
  deltaY: number,
  element: { getBoundingClientRect: () => { width: number; height: number } },
  width: number,
  height: number,
): WorldMapPoint {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.width <= 0 ? 0 : (deltaX / rect.width) * width,
    y: rect.height <= 0 ? 0 : (deltaY / rect.height) * height,
  };
}

function DesktopWorldVenueMap(props: WorldVenueMapProps) {
  const colors = useThemeColors();
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<WorldMapViewport>(DEFAULT_WORLD_MAP_VIEWPORT);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const plotHeight = props.height * DESKTOP_MAP_ASPECT;
  const clusters = useMemo(
    () => clusterWorldVenues(props.venues, props.width, plotHeight, 1, viewport),
    [plotHeight, props.venues, props.width, viewport],
  );
  // Land is projected once at the base viewport. Zoom and pan are affine, so they
  // ride on an SVG transform instead of reprojecting every coastline point per frame.
  const landPath = useMemo(() => WORLD_OUTLINES.map((ring) => ring
    .map(([longitude, latitude], index) => {
      const point = projectWorldPoint(longitude, latitude, props.width, plotHeight);
      return `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    })
    .join(" ") + "Z").join(" "), [plotHeight, props.width]);
  const landTransform = useMemo(
    () => worldMapTransform(props.width, plotHeight, viewport),
    [plotHeight, props.width, viewport],
  );
  const selectAt = useCallback((point: WorldMapPoint, element: { getBoundingClientRect: () => { height: number } }) => {
    const rect = element.getBoundingClientRect();
    const hit = rect.height <= 0 ? 2.4 : (MAP_CLICK_HIT_PX / rect.height) * plotHeight;
    const cluster = closestWorldVenueCluster(clusters, point.x, point.y, Math.max(1.6, hit));
    if (cluster) props.onSelect(clusterVenue(cluster, props.selectedMic));
  }, [clusters, plotHeight, props]);

  useEffect(() => {
    const element = surfaceRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const point = clientToMapPoint(event, element, props.width, plotHeight);
      setViewport((current) => zoomWorldMapViewport(current, props.width, plotHeight, point, wheelZoomFactor(event)));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [plotHeight, props.width]);

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!drag.moved) selectAt(clientToMapPoint(event, event.currentTarget, props.width, plotHeight), event.currentTarget);
  };

  return (
    <Box width={props.width} height={props.height} overflow="hidden">
      <div
        ref={surfaceRef}
        data-gloom-role="world-venue-map"
        data-zoomed={viewport.zoom > 1 ? "true" : "false"}
        role="application"
        aria-label="World venue map"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          dragRef.current = {
            pointerId: event.pointerId,
            lastX: event.clientX,
            lastY: event.clientY,
            originX: event.clientX,
            originY: event.clientY,
            moved: false,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          const travel = Math.hypot(event.clientX - drag.originX, event.clientY - drag.originY);
          if (!drag.moved && travel < MAP_PAN_THRESHOLD_PX) return;
          if (viewportRef.current.zoom <= 1) return;
          drag.moved = true;
          const delta = clientDeltaToMapDelta(event.clientX - drag.lastX, event.clientY - drag.lastY, event.currentTarget, props.width, plotHeight);
          drag.lastX = event.clientX;
          drag.lastY = event.clientY;
          setDragging(true);
          setViewport((current) => panWorldMapViewport(current, props.width, plotHeight, delta.x, delta.y));
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={(event) => {
          const point = clientToMapPoint(event, event.currentTarget, props.width, plotHeight);
          setViewport((current) => zoomWorldMapViewport(current, props.width, plotHeight, point, MAP_DOUBLE_CLICK_ZOOM));
        }}
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          touchAction: "none",
          userSelect: "none",
          cursor: dragging ? "grabbing" : viewport.zoom > 1 ? "grab" : "pointer",
          background: colors.bg,
        }}
      >
        <svg viewBox={`0 0 ${props.width} ${plotHeight}`} width="100%" height="100%" aria-hidden="true" style={{ display: "block", background: colors.bg, pointerEvents: "none" }}>
          <g transform={`translate(${landTransform.translateX} ${landTransform.translateY}) scale(${landTransform.scale})`}>
            <path
              d={landPath}
              fill={colors.textDim}
              fillOpacity="0.14"
              fillRule="evenodd"
              stroke={colors.textDim}
              strokeOpacity="0.7"
              strokeWidth="0.9"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
          {clusters.map((cluster) => {
            const selected = isSelectedCluster(cluster, props.selectedMic);
            const venue = clusterVenue(cluster, props.selectedMic);
            const radius = Math.max(0.55, Math.min(1.5, 0.45 + Math.sqrt(cluster.venues.length) * 0.22));
            return (
              <g key={cluster.id} role="button" tabIndex={0} aria-label={`${cluster.venues.length} venues near ${venue.city}`} onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  props.onSelect(venue);
                }
              }}>
                <title>{`${cluster.venues.length} venue${cluster.venues.length === 1 ? "" : "s"} near ${venue.city}: ${cluster.venues.map((item) => `${item.mic} ${item.name}`).join(", ")}`}</title>
                <circle cx={cluster.x} cy={cluster.y} r={radius + (selected ? 0.24 : 0)} fill={cluster.isOpen ? colors.positive : colors.textMuted} stroke={selected ? colors.selectedText : colors.bg} strokeWidth={selected ? 0.35 : 0.16} vectorEffect="non-scaling-stroke" />
                {cluster.venues.length > 1 ? <text x={cluster.x} y={cluster.y} fill={colors.bg} dy="0.34em" fontSize={Math.max(0.62, Math.min(0.95, radius * 0.78))} fontWeight="700" fontFamily="inherit" textAnchor="middle" pointerEvents="none">{cluster.venues.length}</text> : null}
              </g>
            );
          })}
        </svg>
      </div>
    </Box>
  );
}

export function WorldVenueMap(props: WorldVenueMapProps) {
  return useUiHost().kind === "desktop-web"
    ? <DesktopWorldVenueMap {...props} />
    : <TerminalWorldVenueMap {...props} />;
}
