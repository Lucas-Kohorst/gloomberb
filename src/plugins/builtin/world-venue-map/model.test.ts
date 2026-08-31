import { describe, expect, test } from "bun:test";
import type { CloudWorldVenuePayload } from "../../../api-client";
import {
  clusterWorldVenues,
  DEFAULT_WORLD_MAP_VIEWPORT,
  filterWorldVenues,
  formatVenueCountdown,
  formatVenueLocalTime,
  panWorldMapViewport,
  projectWorldPoint,
  venueRemainingSeconds,
  worldMapTransform,
  zoomWorldMapViewport,
} from "./model";
import { WORLD_OUTLINES } from "./world-outlines";

function venue(overrides: Partial<CloudWorldVenuePayload> = {}): CloudWorldVenuePayload {
  return {
    mic: "XNYS",
    name: "New York Stock Exchange",
    title: "NYSE",
    country: "United States",
    countryCode: "US",
    city: "New York",
    timezone: "America/New_York",
    latitude: 40.7,
    longitude: -74,
    isOpen: true,
    timeToCloseSeconds: 900,
    ...overrides,
  };
}

describe("world venue map model", () => {
  test("projects the viewport center and round-trips geographic coordinates", () => {
    const point = projectWorldPoint(0, DEFAULT_WORLD_MAP_VIEWPORT.centerLatitude, 120, 40);
    expect(point.x).toBeCloseTo(59.5, 5);
    expect(point.y).toBeCloseTo(19.5, 5);
  });

  test("clusters nearby venues while keeping distant venues separate", () => {
    const clusters = clusterWorldVenues([
      venue({ mic: "XNYS", longitude: -74, latitude: 40.7 }),
      venue({ mic: "XNAS", longitude: -73.9, latitude: 40.8, isOpen: false }),
      venue({ mic: "XLON", longitude: -0.1, latitude: 51.5, city: "London" }),
    ], 120, 40);
    expect(clusters).toHaveLength(2);
    expect(clusters.find((cluster) => cluster.venues.length === 2)?.isOpen).toBe(true);
  });

  test("keeps zoom anchored at the pointer and clamps panning", () => {
    const point = projectWorldPoint(-74, 40.7, 120, 40);
    const zoomed = zoomWorldMapViewport(DEFAULT_WORLD_MAP_VIEWPORT, 120, 40, point, 2);
    const anchored = projectWorldPoint(-74, 40.7, 120, 40, 1, zoomed);
    expect(anchored.x).toBeCloseTo(point.x, 5);
    expect(anchored.y).toBeCloseTo(point.y, 5);

    const panned = panWorldMapViewport(zoomed, 120, 40, 10_000, -10_000);
    expect(panned.centerLongitude).toBeGreaterThanOrEqual(-180);
    expect(panned.centerLongitude).toBeLessThanOrEqual(180);
    expect(panned.centerLatitude).toBeGreaterThanOrEqual(-60);
    expect(panned.centerLatitude).toBeLessThanOrEqual(85);
  });

  test("filters by venue metadata and puts open venues first", () => {
    const results = filterWorldVenues([
      venue({ mic: "XLON", name: "London Stock Exchange", title: "LSE", city: "London", isOpen: false }),
      venue({ mic: "XNYS", isOpen: true }),
      venue({ mic: "XJPX", name: "Japan Exchange Group", title: "JPX", city: "Tokyo", country: "Japan", countryCode: "JP", isOpen: true }),
    ], "exchange");
    expect(results.map((item) => item.mic)).toEqual(["XJPX", "XNYS", "XLON"]);
  });

  test("advances countdowns from the server check time", () => {
    expect(venueRemainingSeconds(venue({ timeToCloseSeconds: 900 }), 100_000, 100_000 + 61_000)).toBe(839);
    expect(venueRemainingSeconds(venue({ isOpen: false, timeToOpenSeconds: 30 }), 100_000, 100_000 + 31_000)).toBe(0);
    expect(formatVenueCountdown(3_661)).toBe("1h 2m");
    expect(formatVenueLocalTime("UTC", Date.UTC(2026, 0, 2, 3, 4))).toBe("03:04");
  });
});

// The coastline data is generated, and a regeneration that reintroduces open rings,
// antimeridian wrapping, or out-of-viewport latitudes streaks fill across the map.
describe("world outline data", () => {
  test("ships closed rings that stay inside the viewport and never wrap the antimeridian", () => {
    expect(WORLD_OUTLINES.length).toBeGreaterThan(100);
    for (const ring of WORLD_OUTLINES) {
      expect(ring.length).toBeGreaterThanOrEqual(4);
      expect(ring[0]).toEqual(ring[ring.length - 1]!);
      for (let index = 0; index < ring.length; index += 1) {
        const [longitude, latitude] = ring[index]!;
        expect(longitude).toBeGreaterThanOrEqual(-180);
        expect(longitude).toBeLessThanOrEqual(180);
        expect(latitude).toBeGreaterThan(-60);
        expect(latitude).toBeLessThan(85);
        if (index > 0) {
          expect(Math.abs(longitude - ring[index - 1]![0])).toBeLessThan(180);
        }
      }
    }
  });

  test("moves land with an affine transform instead of reprojecting it", () => {
    const zoomed = zoomWorldMapViewport(DEFAULT_WORLD_MAP_VIEWPORT, 120, 40, { x: 60, y: 20 }, 4);
    const transform = worldMapTransform(120, 40, zoomed);
    expect(transform.scale).toBeCloseTo(zoomed.zoom, 5);
    for (const [longitude, latitude] of [[-74, 40.7], [139.7, 35.7], [0, 0]] as const) {
      const projected = projectWorldPoint(longitude, latitude, 120, 40, 1, zoomed);
      const base = projectWorldPoint(longitude, latitude, 120, 40);
      expect(transform.translateX + transform.scale * base.x).toBeCloseTo(projected.x, 5);
      expect(transform.translateY + transform.scale * base.y).toBeCloseTo(projected.y, 5);
    }
  });
});
