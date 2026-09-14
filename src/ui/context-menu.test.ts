import { describe, expect, test } from "bun:test";
import type { PluginRegistry } from "../plugins/registry";
import type { ContextMenuItem } from "../types/context-menu";
import type { TickerRecord } from "../types/ticker";
import {
  editableTextContextMenuItems,
  linkContextMenuItems,
  tickerContextMenuItems,
} from "./context-menu";

function ticker(overrides: Partial<TickerRecord["metadata"]> = {}): TickerRecord {
  return {
    metadata: {
      ticker: "AAPL",
      exchange: "NASDAQ",
      currency: "USD",
      name: "Apple",
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
      ...overrides,
    },
  };
}

function menuLabels(items: ContextMenuItem[]): string[] {
  return items.flatMap((item) => item.type === "divider" ? [] : [item.label ?? ""]);
}

describe("context menu item builders", () => {
  test("editable text menu returns native edit roles", () => {
    expect(editableTextContextMenuItems().map((item) => item.type === "role" ? item.role : "divider")).toEqual([
      "undo",
      "redo",
      "divider",
      "cut",
      "copy",
      "paste",
      "divider",
      "selectAll",
    ]);
  });

  test("link menu includes open and copy actions", () => {
    const labels = menuLabels(linkContextMenuItems({
      url: "https://example.com",
      open: () => {},
      copy: () => {},
    }));

    expect(labels).toEqual(["Open Link", "Copy Link"]);
  });

  test("ticker row menu builds portfolio actions and keeps registered actions", () => {
    const commands: string[] = [];
    const copied: string[] = [];
    const opened: string[] = [];
    const registry = {
      tickerActions: new Map([
        ["research", {
          id: "research",
          label: "Open research",
          keywords: [],
          execute: () => {},
        }],
      ]),
      navigateTicker: () => {},
      pinTicker: () => {},
      openCommandBar: (query?: string) => { commands.push(query ?? ""); },
    } as unknown as PluginRegistry;
    const items = tickerContextMenuItems({
      ticker: ticker({ watchlists: ["watchlist:tech"] }),
      financials: null,
      registry,
      openExternal: (url) => { opened.push(url); },
      copyText: async (symbol) => { copied.push(symbol); },
    });
    const actions = new Map(
      items
        .filter((item) => item.type !== "divider")
        .map((item) => [item.id, item.onSelect]),
    );

    expect(items.find((item) => item.type !== "divider" && item.id === "ticker:add-to"))
      .toMatchObject({
        label: "Add to...",
        submenu: [
          { id: "ticker:add-watchlist", label: "Watchlist..." },
          { id: "ticker:add-portfolio", label: "Portfolio..." },
        ],
      });
    expect(menuLabels(items)).toContain("Open research");
    actions.get("ticker:chart")?.();
    actions.get("ticker:alert")?.();
    actions.get("ticker:copy-symbol")?.();
    actions.get("ticker:open-yahoo")?.();

    expect(commands).toEqual(["GP AAPL", "SA AAPL"]);
    expect(copied).toEqual(["AAPL"]);
    expect(opened).toEqual(["https://finance.yahoo.com/quote/AAPL"]);
  });

  test("ticker menu only includes removals for collection members", () => {
    const emptyLabels = menuLabels(tickerContextMenuItems({
      ticker: ticker(),
      financials: null,
      registry: null,
      openExternal: () => {},
      copyText: async () => {},
    }));
    const memberLabels = menuLabels(tickerContextMenuItems({
      ticker: ticker({ watchlists: ["watchlist:tech"], portfolios: ["portfolio:main"] }),
      financials: null,
      registry: null,
      openExternal: () => {},
      copyText: async () => {},
    }));

    expect(emptyLabels).not.toContain("Remove from Watchlist...");
    expect(emptyLabels).not.toContain("Remove from Portfolio...");
    expect(memberLabels).toContain("Remove from Watchlist...");
    expect(memberLabels).toContain("Remove from Portfolio...");
  });
});
