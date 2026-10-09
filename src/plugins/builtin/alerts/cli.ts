import { withConfigData } from "../../../cli/scoped-context";
import { CLI_COMMAND_GROUPS } from "../../../cli/help";
import { dryRunNote } from "../../../cli/helpers";
import { requireArg } from "../../../cli/commands/command-utils";
import { saveConfig } from "../../../data/config/store";
import type { CliCommandContext, CliCommandDef } from "../../../types/plugin";
import { cliStyles } from "../../../utils/cli-output";
import { createAlert, deserializeAlerts, formatAlertDescription, rearmAlert, serializeAlerts } from "./alert-engine";
import { parseAlertCondition } from "./command";
import { ALERTS_KEY } from "./constants";
import type { AlertCondition } from "./types";

const ALERTS_PLUGIN_ID = "alerts";

function alertAddTarget(
  condition: AlertCondition,
  raw: string | undefined,
  usage: string,
  ctx: CliCommandContext,
): number {
  if (condition === "halted") {
    if (raw != null && raw.trim() !== "") ctx.fail("Halted alerts do not take a target.");
    return 0;
  }
  const price = Number(requireArg(raw, usage, ctx).replace(/^\$/, "").replace(/%$/, ""));
  if (!Number.isFinite(price)) ctx.fail("Alert target must be a finite number.");
  if ((condition === "short_float" || condition === "ex_div" || condition === "pct_day") && price < 0) {
    ctx.fail("Alert target must be a non-negative number.");
  }
  return price;
}

export const alertsCliCommand: CliCommandDef = {
  name: "alerts",
  aliases: ["alert"],
  description: "List, add, and remove price alerts",
  help: {
    group: CLI_COMMAND_GROUPS.portfolios,
    usage: [
      "alerts list",
      "alerts add <symbol> <above|below|crosses> <price>",
      "alerts add <symbol> halted",
      "alerts add <symbol> <ex_div|pct_day|short_float> <target>",
      "alerts delete <id>",
      "alerts rearm <id>",
    ],
    examples: ["alerts", "alerts add AAPL above 250", "alerts add AAPL halted", "alerts add AAPL ex_div 7", "alerts add AAPL pct_day 5", "alerts add AAPL short_float 5"],
  },
  execute: async (args, ctx) => {
    const action = args[0] ?? "list";
    await withConfigData(ctx, async (config) => {
      const raw = config.config.pluginConfig[ALERTS_PLUGIN_ID]?.[ALERTS_KEY];
      const alerts = deserializeAlerts(typeof raw === "string" ? raw : "[]");
      const saveAlerts = async (nextAlerts: typeof alerts) => {
        const nextConfig = {
          ...config.config,
          pluginConfig: {
            ...config.config.pluginConfig,
            [ALERTS_PLUGIN_ID]: {
              ...(config.config.pluginConfig[ALERTS_PLUGIN_ID] ?? {}),
              [ALERTS_KEY]: serializeAlerts(nextAlerts),
            },
          },
        };
        if (!ctx.cliOptions.dryRun) await saveConfig(nextConfig);
      };

      if (action === "list") {
        ctx.printResult({ data: alerts }, {
          textColumns: [
            { key: "id", header: "ID", shrink: false },
            { key: "symbol", header: "Symbol" },
            { key: "condition", header: "Condition" },
            { key: "targetPrice", header: "Target", align: "right" },
            { key: "status", header: "Status" },
            { key: "lastCheckedPrice", header: "Last Price", align: "right", optional: true },
            { key: "createdAt", header: "Created", optional: true },
            { key: "triggeredAt", header: "Triggered" },
          ],
          empty: "No alerts. Add one with gloomberb alerts add <symbol> <above|below|crosses> <price>.",
        });
        return;
      }
      if (action === "add") {
        const usage = "Usage: gloomberb alerts add <symbol> <above|below|crosses|halted|ex_div|pct_day|short_float> [target]";
        const symbol = requireArg(args[1]?.toUpperCase(), usage, ctx);
        const condition = parseAlertCondition(requireArg(args[2], usage, ctx));
        if (!condition) {
          return ctx.fail("Condition must be above, below, crosses, halted, ex_div, pct_day, or short_float.");
        }
        const price = alertAddTarget(condition, args[3], usage, ctx);
        const alert = createAlert(symbol, condition, price);
        await saveAlerts([...alerts, alert]);
        ctx.printResult({ data: { changed: !ctx.cliOptions.dryRun, dryRun: ctx.cliOptions.dryRun, alert } }, {
          text: (data) => `Added alert ${data.alert.id}: ${formatAlertDescription(data.alert)}.${dryRunNote(data.dryRun)}`,
        });
        return;
      }
      if (action === "delete" || action === "rm") {
        const id = requireArg(args[1], "Usage: gloomberb alerts delete <id>", ctx);
        const next = alerts.filter((alert) => alert.id !== id);
        await saveAlerts(next);
        ctx.printResult({ data: { changed: !ctx.cliOptions.dryRun && next.length !== alerts.length, dryRun: ctx.cliOptions.dryRun, id } }, {
          text: (data) => next.length === alerts.length
            ? cliStyles.muted(`No alert with ID ${id}.`)
            : `Deleted alert ${id}.${dryRunNote(data.dryRun)}`,
        });
        return;
      }
      if (action === "rearm") {
        const id = requireArg(args[1], "Usage: gloomberb alerts rearm <id>", ctx);
        const next = alerts.map((alert) => alert.id === id ? rearmAlert(alert) : alert);
        await saveAlerts(next);
        ctx.printResult({ data: { changed: !ctx.cliOptions.dryRun, dryRun: ctx.cliOptions.dryRun, id } }, {
          text: (data) => alerts.some((alert) => alert.id === id)
            ? `Re-armed alert ${id}.${dryRunNote(data.dryRun)}`
            : cliStyles.muted(`No alert with ID ${id}.`),
        });
        return;
      }
      ctx.fail("Usage: gloomberb alerts list|add|delete|rearm");
    });
  },
};
