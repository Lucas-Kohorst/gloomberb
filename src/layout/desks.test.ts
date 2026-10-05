import { describe, expect, test } from "bun:test";
import { commands } from "../components/command-bar/commands/registry";
import { parseRootShortcutIntent } from "../components/command-bar/routes/root/shortcuts";
import { createDefaultConfig, type AppConfig } from "../types/config";
import type { PaneDef, PaneTemplateDef, CommandDef } from "../types/plugin";
import type { TickerRecord } from "../types/ticker";
import {
  DESK_KEYS,
  DESKS,
  buildDesk,
  deskFunctions,
  getDesk,
  isDeskStock,
  matchDesks,
  pickDeskCompany,
  type DeskCatalog,
} from "./desks";

const RESERVED = ["EEO", "EM", "TAPE", "TAS", "RF", "RISK", "HDS", "FUT", "ETF", "DES"] as const;

function paneDef(id: string): PaneDef {
  return { id, name: id, description: id } as PaneDef;
}

function template(prefix: string, paneId = prefix.toLowerCase()): PaneTemplateDef {
  return {
    id: `${prefix}-template`,
    paneId,
    label: prefix,
    description: prefix,
    shortcut: { prefix, argKind: "ticker" },
    createInstance: (_context, options) => ({
      title: options?.symbol ?? prefix,
      binding: options?.symbol ? { kind: "fixed", symbol: options.symbol } : { kind: "none" },
    }),
  };
}

function catalog(prefixes: readonly string[]): DeskCatalog {
  const templates = prefixes.map((prefix) => template(prefix));
  return {
    panes: new Map(templates.map((entry) => [entry.paneId, paneDef(entry.paneId)])),
    paneTemplates: new Map(templates.map((entry) => [entry.id, entry])),
  };
}

function config(): AppConfig {
  return createDefaultConfig("/tmp/gloomberb-desks");
}

function ticker(symbol: string, assetCategory: string): TickerRecord {
  return {
    metadata: {
      ticker: symbol,
      name: symbol,
      exchange: "NASDAQ",
      currency: "USD",
      assetCategory,
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
    },
  };
}

describe("trading desks", () => {
  test("lists six desks and matches a key, a label, or a function", () => {
    expect(DESK_KEYS).toEqual(["equities", "options", "futures", "rates", "fx", "active"]);
    expect(matchDesks("")).toEqual([...DESKS]);
    expect(matchDesks("rates").map((desk) => desk.key)).toEqual(["rates"]);
    expect(matchDesks("macro").map((desk) => desk.key)).toEqual(["fx"]);
    expect(matchDesks("G").map((desk) => desk.key)).toEqual(["equities", "active"]);
    expect(matchDesks("no-such-desk")).toEqual([]);
    expect(deskFunctions(getDesk("equities"))).toEqual(["DES", "G", "FA", "ERN", "TOP", "EQS"]);
  });

  test("picks the first stock and falls back to AAPL", () => {
    expect(isDeskStock(ticker("AAPL", "STK"))).toBe(true);
    expect(isDeskStock(ticker("SPY", "ETF"))).toBe(false);
    expect(isDeskStock(ticker("CL", ""))).toBe(false);
    expect(isDeskStock(null)).toBe(false);
    expect(pickDeskCompany(["SPY", "NVDA"], (symbol) => symbol === "NVDA")).toBe("NVDA");
    expect(pickDeskCompany(["SPY", "QQQ"], () => false)).toBe("AAPL");
  });

  test("builds a desk from the functions the host has and follows the lead pane", async () => {
    const saved = await buildDesk(getDesk("equities"), {
      catalog: catalog(["TR", "G"]),
      config: config(),
      company: "NVDA",
      pro: false,
    });
    expect(saved?.name).toBe("Equities");
    expect(saved?.layout.instances.map((instance) => instance.paneId).sort()).toEqual(["g", "tr"]);
    const lead = saved?.layout.instances.find((instance) => instance.paneId === "tr");
    const follower = saved?.layout.instances.find((instance) => instance.paneId === "g");
    expect(lead?.binding).toEqual({ kind: "fixed", symbol: "NVDA" });
    expect(follower?.binding).toEqual({ kind: "follow", sourceInstanceId: lead?.instanceId });
    expect(saved?.layout.dockRoot?.kind).toBe("split");
  });

  test("leaves out functions the host does not ship, including a whole desk", async () => {
    const options = await buildDesk(getDesk("options"), {
      catalog: catalog(["OMON"]),
      config: config(),
      company: "AAPL",
      pro: false,
    });
    expect(options?.layout.instances.map((instance) => instance.paneId)).toEqual(["omon"]);
    expect(await buildDesk(getDesk("rates"), {
      catalog: catalog([]),
      config: config(),
      company: "AAPL",
      pro: false,
    })).toBeNull();
  });

  test("adds the options Pro row only when the account has Pro", async () => {
    const host = catalog(["OMON", "FLOW"]);
    const free = await buildDesk(getDesk("options"), { catalog: host, config: config(), company: "AAPL", pro: false });
    const pro = await buildDesk(getDesk("options"), { catalog: host, config: config(), company: "AAPL", pro: true });
    expect(free?.layout.instances.map((instance) => instance.paneId)).toEqual(["omon"]);
    expect(pro?.layout.instances.map((instance) => instance.paneId).sort()).toEqual(["flow", "omon"]);
  });

  test("DESK does not steal DES or the other reserved shortcuts", () => {
    const deskCommand: CommandDef = {
      id: "add-desk",
      label: "Add a Desk",
      keywords: [],
      category: "config",
      shortcut: "DESK",
      shortcutArg: { placeholder: "desk", kind: "text", parse: (arg) => ({ query: arg.trim() }) },
      execute: () => {},
    };
    const paneTemplates: PaneTemplateDef[] = RESERVED.map((prefix) => template(prefix));
    const intentFor = (query: string) => parseRootShortcutIntent({
      query,
      commands,
      pluginCommands: [deskCommand],
      paneTemplates,
      activeTicker: null,
    });
    for (const prefix of RESERVED) {
      const intent = intentFor(prefix);
      expect(intent.kind === "none" ? null : intent.prefix).toBe(prefix);
    }
    expect(intentFor("DESK").kind === "none" ? null : intentFor("DESK").prefix).toBe("DESK");
    expect(intentFor("DESK equities").kind === "none" ? null : intentFor("DESK equities").prefix).toBe("DESK");
    expect(intentFor("DES AAPL").kind === "none" ? null : intentFor("DES AAPL").prefix).toBe("DES");
  });
});
