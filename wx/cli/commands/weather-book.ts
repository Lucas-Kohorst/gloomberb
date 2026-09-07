import type { CliCommandDef } from "../../../src/types/plugin";
import { queryWxBookDay, queryWxBookRange, formatClock } from "../../plugins/builtin/weather/book";
import { zonedDateKey } from "../../../src/plugins/builtin/weather/mapping";
import { findWeatherStation } from "../../../src/plugins/builtin/weather/stations";
import { requireArg, takeOption } from "./command-utils";

function parseClock(value: string | undefined): { hour: number; minute: number } {
  if (!value) return { hour: 11, minute: 0 };
  const match = /^(\d{1,2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return { hour: 11, minute: 0 };
  return {
    hour: Math.min(23, Math.max(0, Number(match[1]))),
    minute: Math.min(59, Math.max(0, Number(match[2] ?? 0))),
  };
}

function parseRangeDays(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d+)d$/i.exec(value.trim());
  if (!match) return null;
  return Math.min(31, Math.max(1, Number(match[1])));
}

function formatPct(value: number | null): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export const weatherBookCliCommand: CliCommandDef = {
  name: "wx-book",
  aliases: ["weather-book"],
  description: "Kalshi daily-high book at a local cutoff vs settlement print",
  help: {
    usage: ["wx-book <station> [date] [--cutoff 11:00] [--range 14d]"],
  },
  execute: async (args, ctx) => {
    const station = requireArg(args[0], "Usage: gloomberb wx-book <station> [date] [--cutoff 11:00] [--range 14d]", ctx);
    const cutoff = parseClock(takeOption(args, "--cutoff"));
    const rangeDays = parseRangeDays(takeOption(args, "--range"));
    const known = findWeatherStation(station);
    const timeZone = known?.timezone ?? "UTC";
    const date = args[1] ?? zonedDateKey(timeZone);
    if (rangeDays != null) {
      const fromMs = Date.parse(`${date}T00:00:00Z`) - (rangeDays - 1) * 86_400_000;
      const from = new Date(fromMs).toISOString().slice(0, 10);
      const range = await queryWxBookRange({ stationId: station, from, to: date, cutoff });
      ctx.printResult({
        data: range.rows.map((row) => ({
          date: row.date,
          favorite: row.favoriteLabel,
          yes: row.favoriteYes,
          print: row.settlementF,
          hit: row.hit,
        })),
        metadata: {
          station: range.stationId,
          cutoff: formatClock(cutoff),
          samples: range.samples,
          hitRate: formatPct(range.hitRate),
          pearson: range.pearson,
          skipped: range.skipped,
        },
      }, {
        columns: [
          { key: "date", header: "Date" },
          { key: "favorite", header: "Favorite" },
          { key: "yes", header: "Yes", align: "right" },
          { key: "print", header: "Print", align: "right" },
          { key: "hit", header: "Hit" },
        ],
      });
      return;
    }
    const day = await queryWxBookDay({ stationId: station, date, cutoff });
    ctx.printResult({
      data: {
        station: day.stationId,
        date: day.date,
        cutoff: `${formatClock(cutoff)} ${day.timeZone}`,
        favorite: day.favorite?.bucket.label ?? null,
        yes: day.favorite?.yesPrice ?? null,
        settlement: day.settlementF,
        nwsRunningHigh: day.runningHighAtCutoffF,
        nwsDayHigh: day.asos.dayHighF,
        hit: day.hit,
        prints: day.asos.points.length,
        status: day.status,
      },
    });
  },
};
