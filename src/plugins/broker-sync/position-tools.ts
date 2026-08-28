export const ROBINHOOD_TRADE_TOOLS = Object.freeze([
  "review_equity_order",
  "place_equity_order",
  "cancel_equity_order",
  "review_option_order",
  "place_option_order",
  "cancel_option_order",
]);

export interface ListedRobinhoodTool {
  name: string;
  inputSchema?: unknown;
  annotations?: { readOnlyHint?: boolean };
}

const POSITION_TOOL_RE = /^get_(?:equity|crypto)_positions$/;

export function discoverRobinhoodPositionTools(tools: ListedRobinhoodTool[]): Map<string, ListedRobinhoodTool> {
  const available = new Map(tools.map((tool) => [tool.name, tool]));
  const accounts = available.get("get_accounts");
  if (!accounts || accounts.annotations?.readOnlyHint === false) {
    throw new Error("Robinhood did not expose the read-only get_accounts tool.");
  }

  const positions = new Map<string, ListedRobinhoodTool>([["get_accounts", accounts]]);
  for (const tool of tools) {
    if (!POSITION_TOOL_RE.test(tool.name)) continue;
    if (tool.annotations?.readOnlyHint === false) {
      throw new Error(`Robinhood did not expose the read-only ${tool.name} tool.`);
    }
    positions.set(tool.name, tool);
  }
  if (positions.size === 1) {
    throw new Error("Robinhood did not expose a read-only positions tool.");
  }
  return positions;
}

export function findRobinhoodTool(
  tools: ListedRobinhoodTool[],
  name: string,
): ListedRobinhoodTool | undefined {
  return tools.find((tool) => tool.name === name);
}

export function isRobinhoodTradeTool(name: string): boolean {
  return (ROBINHOOD_TRADE_TOOLS as readonly string[]).includes(name);
}

export function isRobinhoodAgenticAccount(account: {
  name?: string;
  accountId?: string;
  accountType?: string;
}): boolean {
  const haystack = [account.name, account.accountType, account.accountId]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ");
  return /agentic/i.test(haystack);
}

export function assertRobinhoodAgenticTrade(account: {
  name?: string;
  accountId?: string;
  accountType?: string;
} | null, accountId: string): void {
  if (!account) {
    throw new Error(`Robinhood account "${accountId}" was not found.`);
  }
  if (!isRobinhoodAgenticAccount(account)) {
    throw new Error(
      "Robinhood trading is limited to the Agentic account. Other accounts stay read-only.",
    );
  }
}
