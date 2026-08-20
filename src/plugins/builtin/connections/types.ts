export const CONNECTION_KINDS = [
  "asset-data",
  "data",
  "news",
  "broker",
  "prediction-market",
  "websocket",
  "api",
] as const;

export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

export type ConnectionStatus = "connected" | "disconnected" | "error" | "idle" | "reconnecting";

export interface RequestRecord {
  timestamp: number;
  durationMs: number;
  success: boolean;
  error?: string;
  operation?: string;
}

export interface ConnectionState {
  id: string;
  name: string;
  kind: ConnectionKind;
  status: ConnectionStatus;
  priority: number;
  lastPolledAt: number | null;
  lastLatencyMs: number | null;
  successCount: number;
  failureCount: number;
  lastError: string | null;
  isWebSocket: boolean;
  wsState: "open" | "closed" | "connecting" | "idle";
  lastMessageAt: number | null;
  pluginId: string;
  /** When false, the source has public/keyless endpoints and needs no API key. */
  authRequired?: boolean;
  recentRequests: RequestRecord[];
}

export interface ConnectionSnapshot {
  connections: ConnectionState[];
  version: number;
}

const MAX_RECENT_REQUESTS = 20;

export function createInitialConnectionState(
  id: string,
  name: string,
  kind: ConnectionKind,
  pluginId: string,
  priority = 1000,
  isWebSocket = false,
  authRequired?: boolean,
): ConnectionState {
  return {
    id,
    name,
    kind,
    status: "idle",
    priority,
    lastPolledAt: null,
    lastLatencyMs: null,
    successCount: 0,
    failureCount: 0,
    lastError: null,
    isWebSocket,
    wsState: isWebSocket ? "idle" : "closed",
    lastMessageAt: null,
    pluginId,
    authRequired,
    recentRequests: [],
  };
}

export function recordRequest(
  state: ConnectionState,
  record: Omit<RequestRecord, "timestamp">,
  now = Date.now(),
): ConnectionState {
  const fullRecord: RequestRecord = { ...record, timestamp: now };
  const recentRequests = [fullRecord, ...state.recentRequests].slice(0, MAX_RECENT_REQUESTS);
  const successCount = state.successCount + (record.success ? 1 : 0);
  const failureCount = state.failureCount + (record.success ? 0 : 1);
  return {
    ...state,
    lastPolledAt: now,
    lastLatencyMs: record.durationMs,
    successCount,
    failureCount,
    status: record.success ? "connected" : "error",
    lastError: record.success ? null : (record.error ?? "Request failed"),
    recentRequests,
  };
}

export function updateWebSocketState(
  state: ConnectionState,
  wsState: ConnectionState["wsState"],
  now = Date.now(),
): ConnectionState {
  const status: ConnectionStatus = wsState === "open"
    ? "connected"
    : wsState === "connecting"
      ? "reconnecting"
      : wsState === "closed"
        ? "disconnected"
        : "idle";
  return {
    ...state,
    wsState,
    status,
    lastMessageAt: wsState === "open" ? state.lastMessageAt : state.lastMessageAt,
  };
}

export function recordWebSocketMessage(
  state: ConnectionState,
  now = Date.now(),
): ConnectionState {
  return {
    ...state,
    lastMessageAt: now,
    wsState: "open",
    status: "connected",
  };
}

export function latencyColor(latencyMs: number | null, good = 500, warn = 2000): string | null {
  if (latencyMs == null) return null;
  if (latencyMs <= good) return null; // caller picks default
  if (latencyMs <= warn) return "warn";
  return "error";
}
