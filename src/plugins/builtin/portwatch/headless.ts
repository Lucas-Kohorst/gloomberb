import type { HeadlessBundleSection, HeadlessPaneDefinition } from "../../../types/plugin";
import { fetchShippingBoard } from "./client";
import { formatVolume, type ShippingLayer } from "./model";

function section(title: string, layer: ShippingLayer): HeadlessBundleSection {
  return {
    title,
    columns: [
      { key: "name", header: "Name" },
      { key: "country", header: "Country" },
      ...(layer.volumeHeader ? [{
        key: "volume",
        header: layer.volumeHeader,
        align: "right" as const,
        format: (value: unknown) => formatVolume(typeof value === "number" ? value : null),
      }] : []),
      ...(layer.asOf ? [{ key: "asOf", header: "As of" }] : []),
    ],
    rows: layer.rows.map((row) => ({
      id: row.id,
      name: row.name,
      country: row.country,
      volume: row.volume,
      ...(layer.asOf ? { asOf: layer.asOf } : {}),
    })),
  };
}

export const portwatchHeadless: HeadlessPaneDefinition<"bundle"> = {
  shape: "bundle",
  argument: { kind: "none" },
  options: [],
  discovery: {
    aliases: ["SHIP"],
    dataRequirements: ["Published port and strait vessel-call counts"],
    limitations: [
      "At most 80 places, the busiest when a call count is published.",
      "A strait may have no country.",
      "Counts are a stock of vessel calls, not a daily transit series.",
    ],
  },
  description: "Ports and chokepoints ranked by vessel calls.",
  describe: "Ports and chokepoints by vessel calls",
  async load(_args, ctx) {
    const board = await fetchShippingBoard(ctx.signal);
    const errors = [board.ports.error, board.chokepoints.error].filter((error): error is string => !!error);
    return {
      complete: errors.length === 0,
      sections: [section("Ports", board.ports), section("Chokepoints", board.chokepoints)],
      errors,
      metadata: { portsAsOf: board.ports.asOf, chokepointsAsOf: board.chokepoints.asOf },
    };
  },
};
