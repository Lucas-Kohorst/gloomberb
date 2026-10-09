import { describe, expect, test } from "bun:test";
import { chokepointServiceName, parseFeatureLayer } from "./client";

const JUNE = Date.parse("2024-06-02T00:00:00Z");
const MAY = Date.parse("2024-05-01T00:00:00Z");

describe("shipping volume parsing", () => {
  test("parses a feature layer, drops a blank name, and sorts calls with the latest date", () => {
    const layer = parseFeatureLayer({
      fields: [
        { name: "portname", type: "esriFieldTypeString" },
        { name: "country", type: "esriFieldTypeString" },
        { name: "vessel_count_total", type: "esriFieldTypeInteger" },
        { name: "observed", type: "esriFieldTypeDate" },
      ],
      features: [
        { attributes: { portid: "a", portname: "Alpha", country: "Norway", vessel_count_total: 12, observed: JUNE } },
        { attributes: { portid: "b", portname: "Beta", country: "Japan", vessel_count_total: 90, observed: MAY } },
        { attributes: { portid: "c", portname: "  ", country: "X", vessel_count_total: 5, observed: JUNE } },
      ],
    });
    expect(layer.rows.map((row) => row.name)).toEqual(["Beta", "Alpha"]);
    expect(layer.rows[0]).toMatchObject({ id: "b", country: "Japan", volume: 90 });
    expect(layer.volumeHeader).toBe("Calls");
    expect(layer.asOf).toBe("2024-06-02");
    expect(layer.error).toBeNull();
  });

  test("keeps the 80 largest volumes when the layer has no field list", () => {
    const features = Array.from({ length: 100 }, (_, index) => ({
      attributes: { portname: `Port ${String(index).padStart(3, "0")}`, country: "X", vessel_count_total: index },
    }));
    const layer = parseFeatureLayer({ features });
    expect(layer.rows).toHaveLength(80);
    expect(layer.rows[0]).toMatchObject({ name: "Port 099", volume: 99 });
    expect(layer.rows[79]?.volume).toBe(20);
    expect(layer.volumeHeader).toBe("Calls");
    expect(layer.asOf).toBeNull();
  });

  test("reads a volume field and a string date, and leaves a missing country blank", () => {
    const layer = parseFeatureLayer({
      features: [
        { attributes: { name: "Hormuz", country: null, trade_volume: 5, as_of: "2025-01-15" } },
        { attributes: { name: "Malacca", country: "Malaysia", trade_volume: 8, as_of: "2024-12-01" } },
      ],
    });
    expect(layer.volumeHeader).toBe("Volume");
    expect(layer.asOf).toBe("2025-01-15");
    expect(layer.rows.map((row) => row.name)).toEqual(["Malacca", "Hormuz"]);
    expect(layer.rows[1]).toMatchObject({ country: "", volume: 5 });
  });

  test("rejects an error payload and an unexpected shape with a sentence", () => {
    expect(() => parseFeatureLayer({ error: { code: 400, message: "Invalid URL" } }))
      .toThrow("The shipping volume request was rejected.");
    expect(() => parseFeatureLayer(null)).toThrow("Shipping volumes came back in an unexpected shape.");
    expect(parseFeatureLayer({ features: [] })).toMatchObject({ rows: [], volumeHeader: null, asOf: null, error: null });
    for (const message of ["The shipping volume request was rejected.", "Shipping volumes came back in an unexpected shape."]) {
      expect(message.endsWith(".")).toBe(true);
      expect(message).not.toMatch(/IMF|PortWatch|ArcGIS/);
    }
  });

  test("picks the chokepoint feature service from a catalog", () => {
    expect(chokepointServiceName({
      services: [
        { name: "Daily_Trade_Data_WLD", type: "FeatureServer" },
        { name: "PortWatch_chokepoints_view", type: "FeatureServer" },
        { name: "PortWatch_chokepoints_database", type: "FeatureServer" },
        { name: "PortWatch_chokepoints_tile", type: "MapServer" },
      ],
    })).toBe("PortWatch_chokepoints_database");
    expect(chokepointServiceName({ services: [] })).toBeNull();
  });
});
