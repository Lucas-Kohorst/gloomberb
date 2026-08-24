export const ROBINHOOD_POSITION_TOOLS = Object.freeze(["get_accounts", "get_equity_positions"]);

export interface ListedRobinhoodTool {
  name: string;
  inputSchema?: unknown;
  annotations?: { readOnlyHint?: boolean };
}

export function requireRobinhoodPositionTools(tools: ListedRobinhoodTool[]): Map<string, ListedRobinhoodTool> {
  const available = new Map(tools.map((tool) => [tool.name, tool]));
  for (const toolName of ROBINHOOD_POSITION_TOOLS) {
    const tool = available.get(toolName);
    if (!tool || tool.annotations?.readOnlyHint === false) {
      throw new Error(`Robinhood did not expose the read-only ${toolName} tool.`);
    }
  }
  return new Map(ROBINHOOD_POSITION_TOOLS.map((toolName) => [toolName, available.get(toolName)!]));
}
