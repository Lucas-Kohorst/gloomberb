import { createRssNewsCapability } from "../../plugins/builtin/news/wire/rss/source";
import type { CliCommandDef } from "../../types/plugin";
import { withCliServices } from "../context";
import { requireArg, takeOption } from "./command-utils";

export const brokerCliCommand: CliCommandDef = {
  name: "broker",
  aliases: ["brokers"],
  description: "Inspect broker profiles",
  help: { usage: ["broker list", "broker status"] },
  execute: async (args, ctx) => {
    const action = args[0] ?? "list";
    if (action !== "list" && action !== "status") {
      ctx.fail("Usage: gloomberb broker list|status");
    }
    await withCliServices(ctx, async (services) => {
      ctx.printResult({
        data: services.config.brokerInstances.map((instance) => ({
          id: instance.id,
          type: instance.brokerType,
          label: instance.label,
          enabled: instance.enabled !== false,
          connectionMode: instance.connectionMode ?? "",
          lastSyncedAt: instance.lastSyncedAt ? new Date(instance.lastSyncedAt).toISOString() : "",
        })),
      });
    });
  },
};

export const ibkrCliCommand: CliCommandDef = {
  name: "ibkr",
  description: "Inspect IBKR profiles",
  help: { usage: ["ibkr accounts", "ibkr status"] },
  execute: async (args, ctx) => {
    const action = args[0] ?? "status";
    if (action !== "accounts" && action !== "status") {
      ctx.fail("Usage: gloomberb ibkr accounts|status");
    }
    await withCliServices(ctx, async (services) => {
      ctx.printResult({
        data: services.config.brokerInstances
          .filter((instance) => instance.brokerType === "ibkr")
          .map((instance) => ({
            id: instance.id,
            label: instance.label,
            enabled: instance.enabled !== false,
            connectionMode: instance.connectionMode ?? "",
            lastSyncedAt: instance.lastSyncedAt ? new Date(instance.lastSyncedAt).toISOString() : "",
          })),
      });
    });
  },
};

export const rssCliCommand: CliCommandDef = {
  name: "rss",
  description: "Fetch an RSS feed as news rows",
  help: { usage: ["rss fetch <url> [--name label]"] },
  execute: async (args, ctx) => {
    const action = args[0] ?? "fetch";
    if (action !== "fetch") ctx.fail("Usage: gloomberb rss fetch <url> [--name label]");
    const rawArgs = args.slice(1);
    const name = takeOption(rawArgs, "--name") ?? "RSS";
    const url = requireArg(rawArgs[0], "Usage: gloomberb rss fetch <url> [--name label]", ctx);
    const capability = createRssNewsCapability([{
      id: "cli-feed",
      url,
      name,
      category: "cli",
      authority: 50,
      enabled: true,
    }]);
    const articles = await capability.provider.fetchNews({ feed: "latest", limit: ctx.cliOptions.limit ?? 20 });
    ctx.printResult({ data: articles.map((article) => ({
      title: article.title,
      source: article.source,
      publishedAt: article.publishedAt.toISOString(),
      url: article.url,
      summary: article.summary ?? "",
    })) });
  },
};
