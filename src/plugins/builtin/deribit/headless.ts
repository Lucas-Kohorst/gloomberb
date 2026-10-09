import type { HeadlessPaneDefinition } from "../../../types/plugin";
import { fetchDerivatives } from "./client";
import {
  formatChange,
  formatIndexLevel,
  formatIv,
  formatPrice,
  formatSize,
  futureRows,
  optionExpiryRows,
  resolveCurrency,
} from "./model";

const price = (value: unknown) => formatPrice(typeof value === "number" ? value : null);
const size = (value: unknown) => formatSize(typeof value === "number" ? value : null);
const change = (value: unknown) => formatChange(typeof value === "number" ? value : null);
const iv = (value: unknown) => formatIv(typeof value === "number" ? value : null);

export const deribitHeadless: HeadlessPaneDefinition<"bundle"> = {
  shape: "bundle",
  argument: {
    kind: "free-text",
    optional: true,
    placeholder: "BTC",
    description: "BTC or ETH. Defaults to BTC.",
  },
  options: [],
  discovery: {
    aliases: ["DRBT"],
    dataRequirements: ["Public futures book, options book, and 30-day volatility index"],
    limitations: [
      "BTC and ETH only",
      "Options are one row per expiration, not per strike",
      "The volatility index is the latest close when the 30-day series returns points",
    ],
  },
  describe: "Crypto futures and option open interest",
  async load(args, ctx) {
    const currency = resolveCurrency(args.argument);
    const data = await fetchDerivatives(currency, ctx.signal);
    const futures = futureRows(data.futures);
    const options = optionExpiryRows(data.options);
    return {
      complete: true,
      sections: [
        {
          title: `${currency} futures`,
          columns: [
            { key: "instrument", header: "Instrument" },
            { key: "last", header: "Last", align: "right", format: price },
            { key: "mark", header: "Mark", align: "right", format: price },
            { key: "openInterest", header: "Open interest", align: "right", format: size },
            { key: "volume", header: "Volume", align: "right", format: size },
            { key: "change", header: "24h", align: "right", format: change },
          ],
          rows: futures.map((row) => ({
            id: row.id,
            instrument: row.instrument,
            last: row.last,
            mark: row.mark,
            openInterest: row.openInterest,
            volume: row.volume,
            change: row.change,
          })),
        },
        {
          title: `${currency} options`,
          columns: [
            { key: "expiry", header: "Expiry" },
            { key: "openInterest", header: "Open interest", align: "right", format: size },
            { key: "volume", header: "Volume", align: "right", format: size },
            { key: "markIv", header: "Mark IV", align: "right", format: iv },
          ],
          rows: options.map((row) => ({
            id: row.id,
            expiry: row.expiry,
            openInterest: row.openInterest,
            volume: row.volume,
            markIv: row.markIv,
          })),
        },
        ...(data.index ? [{
          title: `${currency} volatility index`,
          entries: [
            { label: "Latest", value: data.index.level, formatted: formatIndexLevel(data.index.level).replace(/^index /, "") },
            { label: "As of", value: new Date(data.index.timestamp).toISOString() },
          ],
        }] : []),
      ],
      metadata: { currency, bookTime: data.bookTime, index: data.index?.level ?? null },
    };
  },
};
