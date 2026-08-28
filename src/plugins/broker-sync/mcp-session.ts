import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ROBINHOOD_MCP_URL } from "../../shared/robinhood-oauth";
import type { BrokerInstanceConfig } from "../../types/config";
import type { BrokerOrder, BrokerOrderPreview, BrokerOrderRequest } from "../../types/trading";
import { normalizeRobinhoodSnapshot, type BrokerPortfolioSnapshot } from "./normalize";
import type { OAuthCallback } from "./oauth-callback";
import {
  cloneRobinhoodOAuth,
  randomOAuthState,
  RobinhoodOAuthProvider,
  type RobinhoodOAuthData,
} from "./oauth-provider";
import {
  assertRobinhoodAgenticTrade,
  discoverRobinhoodPositionTools,
  findRobinhoodTool,
  isRobinhoodAgenticAccount,
  type ListedRobinhoodTool,
} from "./position-tools";
import { createRobinhoodFetch } from "./fetch";

export interface RobinhoodAuthHost {
  startCallback(expectedState: string): Promise<OAuthCallback>;
  openAuthorizationUrl(url: URL): Promise<void>;
  fetch?: typeof fetch;
}

const pendingOAuth = new Map<string, RobinhoodOAuthData>();
const ROBINHOOD_AUTH_STEP_TIMEOUT_MS = 30_000;

export async function awaitRobinhoodAuthStep<T>(
  step: string,
  operation: Promise<T>,
  timeoutMs = ROBINHOOD_AUTH_STEP_TIMEOUT_MS,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Robinhood ${step} timed out. Check your connection and try Sync again.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function takePendingRobinhoodOAuth(instanceId: string): Record<string, unknown> | null {
  const oauth = pendingOAuth.get(instanceId);
  if (!oauth) return null;
  pendingOAuth.delete(instanceId);
  return { connectionMode: "oauth", oauth };
}

function toolPayload(result: unknown): unknown {
  const value = result as {
    isError?: boolean;
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: unknown;
  };
  const text = value.content
    ?.filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
  if (value.isError) throw new Error(text || "Robinhood returned an error.");
  if (!text) return value.structuredContent ?? result;
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("Robinhood returned an invalid tool response.");
  }
}

function schemaProperties(inputSchema: unknown): Record<string, unknown> {
  if (!inputSchema || typeof inputSchema !== "object") return {};
  const properties = (inputSchema as { properties?: unknown }).properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return {};
  return properties as Record<string, unknown>;
}

function accountIds(payload: unknown): string[] {
  const ids = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const item = value as Record<string, unknown>;
    for (const key of ["accountId", "account_id", "accountNumber", "account_number"]) {
      if (typeof item[key] === "string" && item[key]) ids.add(item[key]);
    }
    for (const child of Object.values(item)) visit(child);
  };
  visit(payload);
  return [...ids];
}

function positionArguments(inputSchema: unknown, accountId: string): Record<string, string> {
  const accountKey = Object.keys(schemaProperties(inputSchema)).find((key) => /account/i.test(key));
  return accountKey ? { [accountKey]: accountId } : {};
}

export async function loadRobinhoodPositionPayloads(
  accountIds: readonly string[],
  tools: ReadonlyMap<string, ListedRobinhoodTool>,
  loadTool: (name: string, arguments_: Record<string, string>) => Promise<unknown>,
): Promise<Array<{ toolName: string; payload: unknown }>> {
  const positionTools = [...tools.entries()].filter(([name]) => name !== "get_accounts");
  const requests = accountIds.length > 0
    ? accountIds.flatMap((accountId) => positionTools.map(([toolName, tool]) => (
      loadTool(toolName, positionArguments(tool.inputSchema, accountId))
        .then((payload) => ({ toolName, payload }))
    )))
    : positionTools.map(([toolName]) => (
      loadTool(toolName, {})
        .then((payload) => ({ toolName, payload }))
    ));
  const settled = await Promise.allSettled(requests);
  const payloads = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  if (payloads.length === 0 && settled.length > 0) {
    const failure = settled.find((result) => result.status === "rejected");
    throw failure?.reason;
  }
  return payloads;
}

export function mapRobinhoodOrderArguments(
  inputSchema: unknown,
  request: BrokerOrderRequest,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const orderType = request.orderType === "MKT" ? "market" : request.orderType === "LMT" ? "limit" : request.orderType;
  const values: Array<[RegExp, unknown]> = [
    [/account/i, request.accountId],
    [/symbol|ticker/i, request.contract.symbol],
    [/side|action/i, request.action.toLowerCase()],
    [/quantity|qty|shares/i, request.quantity],
    [/order_?type|ordertype/i, orderType.toLowerCase()],
    [/limit/i, request.limitPrice],
    [/stop/i, request.stopPrice],
    [/time_?in_?force|^tif$/i, request.tif],
  ];
  for (const key of Object.keys(schemaProperties(inputSchema))) {
    for (const [pattern, value] of values) {
      if (value == null || args[key] !== undefined) continue;
      if (pattern.test(key)) args[key] = value;
    }
  }
  return args;
}

async function connectMcp(
  provider: RobinhoodOAuthProvider,
  callback: OAuthCallback,
  fetchImpl?: typeof fetch,
): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const fetchFn = fetchImpl ?? createRobinhoodFetch();
  const makeConnection = async () => {
    const transport = new StreamableHTTPClientTransport(new URL(ROBINHOOD_MCP_URL), {
      authProvider: provider,
      fetch: fetchFn,
    });
    const client = new Client({ name: "gloomberb-robinhood", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
    return { client, transport };
  };
  const transport = new StreamableHTTPClientTransport(new URL(ROBINHOOD_MCP_URL), {
    authProvider: provider,
    fetch: fetchFn,
  });
  const client = new Client({ name: "gloomberb-robinhood", version: "1.0.0" }, { capabilities: {} });
  try {
    await client.connect(transport);
    return { client, transport };
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) {
      await client.close().catch(() => {});
      throw error;
    }
    const authorizationCode = await callback.code;
    await awaitRobinhoodAuthStep("token exchange", transport.finishAuth(authorizationCode));
    await client.close().catch(() => {});
    return await awaitRobinhoodAuthStep("authenticated connection", makeConnection());
  }
}

async function withRobinhoodClient<T>(
  instance: BrokerInstanceConfig,
  host: RobinhoodAuthHost,
  run: (client: Client, tools: ListedRobinhoodTool[]) => Promise<T>,
): Promise<T> {
  const oauth = cloneRobinhoodOAuth(pendingOAuth.get(instance.id) ?? instance.config.oauth);
  const oauthState = randomOAuthState();
  const callback = await host.startCallback(oauthState);
  const provider = new RobinhoodOAuthProvider(
    callback.redirectUrl,
    oauth,
    oauthState,
    host.openAuthorizationUrl,
  );
  let connection: Awaited<ReturnType<typeof connectMcp>> | null = null;
  try {
    connection = await connectMcp(provider, callback, host.fetch ?? createRobinhoodFetch());
    const listed = await connection.client.listTools();
    pendingOAuth.set(instance.id, oauth);
    return await run(connection.client, listed.tools);
  } finally {
    await connection?.client.close().catch(() => {});
    await callback.close();
  }
}

function accountRecord(payload: unknown, accountId: string): { accountId: string; name?: string; accountType?: string } | null {
  const snapshot = normalizeRobinhoodSnapshot(payload, []);
  const account = snapshot.accounts.find((entry) => entry.accountId === accountId);
  if (!account) return null;
  return { accountId: account.accountId, name: account.name };
}

export async function loadRobinhoodPortfolio(
  instance: BrokerInstanceConfig,
  host: RobinhoodAuthHost,
): Promise<BrokerPortfolioSnapshot> {
  return withRobinhoodClient(instance, host, async (client, listed) => {
    const tools = discoverRobinhoodPositionTools(listed);
    const accountsPayload = toolPayload(await client.callTool({ name: "get_accounts", arguments: {} }));
    const ids = accountIds(accountsPayload);
    const positionPayloads = await loadRobinhoodPositionPayloads(
      ids,
      tools,
      (name, arguments_) => client.callTool({ name, arguments: arguments_ }).then(toolPayload),
    );
    return normalizeRobinhoodSnapshot(accountsPayload, positionPayloads);
  });
}

function orderToolName(request: BrokerOrderRequest, kind: "review" | "place" | "cancel"): string {
  const option = request.contract.secType === "OPT" || request.contract.right != null;
  if (kind === "review") return option ? "review_option_order" : "review_equity_order";
  if (kind === "place") return option ? "place_option_order" : "place_equity_order";
  return option ? "cancel_option_order" : "cancel_equity_order";
}

async function requireAgenticAccount(
  client: Client,
  accountId: string,
): Promise<void> {
  const accountsPayload = toolPayload(await client.callTool({ name: "get_accounts", arguments: {} }));
  const account = accountRecord(accountsPayload, accountId);
  if (account && isRobinhoodAgenticAccount(account)) {
    assertRobinhoodAgenticTrade(account, accountId);
    return;
  }
  const raw = findRawAccount(accountsPayload, accountId);
  assertRobinhoodAgenticTrade(raw ?? account, accountId);
}

function findRawAccount(payload: unknown, accountId: string): {
  accountId: string;
  name?: string;
  accountType?: string;
} | null {
  const visit = (value: unknown): { accountId: string; name?: string; accountType?: string } | null => {
    if (!value || typeof value !== "object") return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item);
        if (found) return found;
      }
      return null;
    }
    const item = value as Record<string, unknown>;
    const ids = [item.accountId, item.account_id, item.accountNumber, item.account_number];
    if (ids.some((id) => id === accountId)) {
      return {
        accountId,
        name: typeof item.name === "string" ? item.name : undefined,
        accountType: typeof item.accountType === "string"
          ? item.accountType
          : typeof item.account_type === "string"
            ? item.account_type
            : typeof item.type === "string"
              ? item.type
              : undefined,
      };
    }
    for (const child of Object.values(item)) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  return visit(payload);
}

function textField(payload: unknown, keys: string[]): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function numberField(payload: unknown, keys: string[]): number | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export async function previewRobinhoodOrder(
  instance: BrokerInstanceConfig,
  request: BrokerOrderRequest,
  host: RobinhoodAuthHost,
): Promise<BrokerOrderPreview> {
  if (!request.accountId) throw new Error("Choose the Robinhood Agentic account before previewing an order.");
  return withRobinhoodClient(instance, host, async (client, tools) => {
    await requireAgenticAccount(client, request.accountId!);
    const toolName = orderToolName(request, "review");
    const tool = findRobinhoodTool(tools, toolName);
    if (!tool) throw new Error(`Robinhood did not expose ${toolName}.`);
    const payload = toolPayload(await client.callTool({
      name: toolName,
      arguments: mapRobinhoodOrderArguments(tool.inputSchema, request),
    }));
    return {
      warningText: textField(payload, ["warningText", "warning", "warnings", "message"]) || undefined,
      commission: numberField(payload, ["commission"]),
    };
  });
}

export async function placeRobinhoodOrder(
  instance: BrokerInstanceConfig,
  request: BrokerOrderRequest,
  host: RobinhoodAuthHost,
): Promise<BrokerOrder> {
  if (!request.accountId) throw new Error("Choose the Robinhood Agentic account before placing an order.");
  return withRobinhoodClient(instance, host, async (client, tools) => {
    await requireAgenticAccount(client, request.accountId!);
    const toolName = orderToolName(request, "place");
    const tool = findRobinhoodTool(tools, toolName);
    if (!tool) throw new Error(`Robinhood did not expose ${toolName}.`);
    const payload = toolPayload(await client.callTool({
      name: toolName,
      arguments: mapRobinhoodOrderArguments(tool.inputSchema, request),
    }));
    const orderId = numberField(payload, ["orderId", "order_id", "id"]) ?? Date.now();
    return {
      orderId,
      brokerInstanceId: instance.id,
      accountId: request.accountId,
      status: textField(payload, ["status", "state"]) || "submitted",
      action: request.action,
      orderType: request.orderType,
      quantity: request.quantity,
      filled: numberField(payload, ["filled", "filledQuantity", "filled_quantity"]) ?? 0,
      remaining: numberField(payload, ["remaining", "remainingQuantity"]) ?? request.quantity,
      avgFillPrice: numberField(payload, ["avgFillPrice", "average_price", "avgPrice"]),
      limitPrice: request.limitPrice,
      stopPrice: request.stopPrice,
      tif: request.tif,
      warningText: textField(payload, ["warningText", "warning", "message"]) || undefined,
      updatedAt: Date.now(),
      contract: request.contract,
    };
  });
}

export async function cancelRobinhoodOrder(
  instance: BrokerInstanceConfig,
  orderId: number,
  host: RobinhoodAuthHost,
): Promise<void> {
  return withRobinhoodClient(instance, host, async (client, tools) => {
    const tool = findRobinhoodTool(tools, "cancel_equity_order")
      ?? findRobinhoodTool(tools, "cancel_option_order");
    if (!tool) throw new Error("Robinhood did not expose an order cancel tool.");
    const properties = schemaProperties(tool.inputSchema);
    const orderKey = Object.keys(properties).find((key) => /order/i.test(key)) ?? "order_id";
    const payload = toolPayload(await client.callTool({
      name: tool.name,
      arguments: { [orderKey]: orderId },
    }));
    void payload;
  });
}

export function clearRobinhoodOAuth(instanceId: string): void {
  pendingOAuth.delete(instanceId);
}
