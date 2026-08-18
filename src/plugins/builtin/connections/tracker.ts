import type { PluginCapability, RegisteredCapability } from "../../../capabilities/types";
import type { DataProvider } from "../../../types/data-provider";
import type { GloomPluginContext } from "../../../types/plugin";
import { apiClient } from "../../../api-client";
import { isProviderMiss } from "../../../sources/provider-errors";
import {
  type ConnectionState,
  type ConnectionSnapshot,
  type ConnectionKind,
  type ConnectionStatus,
  type RequestRecord,
  CONNECTION_KINDS,
  createInitialConnectionState,
  recordRequest,
  updateWebSocketState,
} from "./types";
import {
  listConnectionSources,
  setConnectionRequestReporter,
  subscribeConnectionSources,
} from "./register";

type ConnectionListener = (snapshot: ConnectionSnapshot) => void;

const CLOUD_SOCKET_ID = "gloom-cloud-ws";
const CLOUD_REST_ID = "gloom-cloud";
const POLL_INTERVAL_MS = 3000;

interface ProviderEntry {
  id: string;
  name: string;
  kind: ConnectionKind;
  pluginId: string;
  priority: number;
  isWebSocket: boolean;
  authRequired?: boolean;
}

function connectionKindFromCapability(kind: string): ConnectionKind {
  return (CONNECTION_KINDS as readonly string[]).includes(kind)
    ? (kind as ConnectionKind)
    : "api";
}

const statusOrder: Record<ConnectionStatus, number> = {
  error: 0,
  reconnecting: 1,
  connected: 2,
  idle: 3,
  disconnected: 4,
};

/**
 * Tracks the health of every registered data provider, the Gloom Cloud REST API,
 * and the Gloom Cloud WebSocket. State is ephemeral (resume-only) and rebuilt
 * on every app start from the live capability registry.
 */
export class ConnectionTracker {
  private readonly states = new Map<string, ConnectionState>();
  private readonly listeners = new Set<ConnectionListener>();
  private version = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private listCapabilities: (() => RegisteredCapability[]) | null = null;
  private marketData: DataProvider | null = null;
  private disposers: Array<() => void> = [];
  private disposed = false;

  attach(_ctx: GloomPluginContext, listCapabilities: () => RegisteredCapability[], marketData: DataProvider): void {
    this.listCapabilities = listCapabilities;
    this.marketData = marketData;

    this.ensureConnection(CLOUD_REST_ID, "Gloom Cloud", "asset-data", "gloomberb-cloud", 1, false, true);
    this.ensureConnection(CLOUD_SOCKET_ID, "Gloom Cloud Stream", "websocket", "gloomberb-cloud", 0, true, true);

    this.syncFromRegistry();
    this.wrapMarketData();
    this.subscribeCloudUserChanges();
    setConnectionRequestReporter((id, report) => {
      if (report.success) this.recordSuccess(id, report.operation ?? "request", report.durationMs);
      else this.recordFailure(id, report.operation ?? "request", report.durationMs, report.error);
    });
    this.disposers.push(subscribeConnectionSources(() => this.syncFromRegistry()));
    this.disposers.push(() => setConnectionRequestReporter(null));

    this.pollTimer = setInterval(() => {
      this.syncFromRegistry();
      this.refreshCloudState();
    }, POLL_INTERVAL_MS);

    this.refreshCloudState();
  }

  dispose(): void {
    this.disposed = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const dispose of this.disposers) {
      try { dispose(); } catch { /* ignore */ }
    }
    this.disposers = [];
    this.listeners.clear();
  }

  subscribe(listener: ConnectionListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): ConnectionSnapshot {
    return { connections: this.sortedConnections(), version: this.version };
  }

  /** Force a refresh of connection states (e.g. after manual provider calls). */
  refresh(): void {
    this.syncFromRegistry();
    this.refreshCloudState();
  }

  // -- Registry discovery ----------------------------------------------------

  private syncFromRegistry(): void {
    let changed = false;

    for (const source of listConnectionSources()) {
      if (this.ensureConnection(
        source.id,
        source.name,
        source.kind,
        source.pluginId,
        source.priority ?? 1000,
        source.isWebSocket === true,
        source.authRequired,
      )) {
        changed = true;
      }
    }

    if (this.listCapabilities) {
      for (const { capability, pluginId } of this.listCapabilities()) {
        const entry = this.providerEntryFromCapability(capability, pluginId);
        if (!entry) continue;
        if (this.ensureConnection(entry.id, entry.name, entry.kind, entry.pluginId, entry.priority, entry.isWebSocket)) {
          changed = true;
        }
      }
    }

    if (changed) this.notify();
  }

  private providerEntryFromCapability(capability: PluginCapability, pluginId: string): ProviderEntry {
    const kind = connectionKindFromCapability(capability.kind);
    return {
      id: capability.sourceId ?? capability.id,
      name: capability.name,
      kind,
      pluginId,
      priority: capability.priority ?? 1000,
      isWebSocket: kind === "websocket",
    };
  }

  private ensureConnection(
    id: string,
    name: string,
    kind: ConnectionKind,
    pluginId: string,
    priority: number,
    isWebSocket: boolean,
    authRequired?: boolean,
  ): boolean {
    if (this.states.has(id)) return false;
    this.states.set(id, createInitialConnectionState(id, name, kind, pluginId, priority, isWebSocket, authRequired));
    return true;
  }

  // -- Market-data wrapping --------------------------------------------------

  private wrapMarketData(): void {
    if (!this.marketData) return;
    const router = this.marketData;
    const tracker = this;

    function wrap<TArgs extends unknown[], TResult>(
      operation: string,
      fn: (...args: TArgs) => Promise<TResult>,
    ): (...args: TArgs) => Promise<TResult> {
      return async function (...args: TArgs): Promise<TResult> {
        const start = Date.now();
        try {
          const result = await fn.apply(router, args);
          tracker.recordSuccess(CLOUD_REST_ID, operation, Date.now() - start);
          return result;
        } catch (error) {
          if (isProviderMiss(error)) {
            tracker.recordSuccess(CLOUD_REST_ID, operation, Date.now() - start);
          } else {
            tracker.recordFailure(CLOUD_REST_ID, operation, Date.now() - start, error);
          }
          throw error;
        }
      };
    }

    const targets: Array<{ key: keyof DataProvider; op: string }> = [
      { key: "getQuote", op: "getQuote" },
      { key: "getTickerFinancials", op: "getTickerFinancials" },
      { key: "search", op: "search" },
      { key: "getPriceHistory", op: "getPriceHistory" },
      { key: "getHolders", op: "getHolders" },
      { key: "getAnalystResearch", op: "getAnalystResearch" },
      { key: "getCorporateActions", op: "getCorporateActions" },
      { key: "getOptionsChain", op: "getOptionsChain" },
      { key: "getSecFilings", op: "getSecFilings" },
      { key: "getExchangeRate", op: "getExchangeRate" },
      { key: "getEarningsCalendar", op: "getEarningsCalendar" },
      { key: "getQuotesBatch", op: "getQuotesBatch" },
      { key: "getTickerFinancialsBatch", op: "getTickerFinancialsBatch" },
    ];

    for (const { key, op } of targets) {
      const original = (router as unknown as Record<string, unknown>)[key];
      if (typeof original !== "function") continue;
      (router as unknown as Record<string, unknown>)[key] = wrap(op, original as (...args: unknown[]) => Promise<unknown>);
    }
  }

  // -- Cloud socket monitoring -----------------------------------------------

  private subscribeCloudUserChanges(): void {
    const dispose = apiClient.subscribeCurrentUser(() => {
      this.refreshCloudState();
    });
    this.disposers.push(dispose);
  }

  private refreshCloudState(): void {
    if (this.disposed) return;
    const verified = apiClient.isVerified();
    const token = apiClient.getSessionToken();
    const hasAuth = !!token;

    const wsState: ConnectionState["wsState"] = verified ? "open" : hasAuth ? "connecting" : "idle";
    const wsState_ = this.states.get(CLOUD_SOCKET_ID);
    if (wsState_) {
      const updated = updateWebSocketState(wsState_, wsState);
      if (updated.status !== wsState_.status || updated.wsState !== wsState_.wsState) {
        this.states.set(CLOUD_SOCKET_ID, updated);
        this.notify();
      }
    }

    const restState = this.states.get(CLOUD_REST_ID);
    if (restState && restState.status === "idle" && hasAuth) {
      this.states.set(CLOUD_REST_ID, { ...restState, status: "connected" });
      this.notify();
    }
  }

  // -- Request recording -----------------------------------------------------

  private recordSuccess(id: string, operation: string, durationMs: number): void {
    const state = this.ensureStateForReport(id);
    if (!state) return;
    this.states.set(id, recordRequest(state, { success: true, durationMs, operation }));
    this.notify();
  }

  private recordFailure(id: string, operation: string, durationMs: number, error: unknown): void {
    const state = this.ensureStateForReport(id);
    if (!state) return;
    const message = error instanceof Error ? error.message : String(error);
    this.states.set(id, recordRequest(state, { success: false, durationMs, operation, error: message }));
    this.notify();
  }

  /**
   * Traffic can arrive before syncFromRegistry observes a just-registered
   * source (parallel plugin setup). Hydrate from the source registry so the
   * report is not dropped into a permanent Idle row.
   */
  private ensureStateForReport(id: string): ConnectionState | null {
    const existing = this.states.get(id);
    if (existing) return existing;
    const source = listConnectionSources().find((entry) => entry.id === id);
    if (!source) return null;
    this.ensureConnection(
      source.id,
      source.name,
      source.kind,
      source.pluginId,
      source.priority ?? 1000,
      source.isWebSocket === true,
      source.authRequired,
    );
    return this.states.get(id) ?? null;
  }

  // -- Snapshot + notify -----------------------------------------------------

  private sortedConnections(): ConnectionState[] {
    return [...this.states.values()].sort((a, b) => {
      const orderDiff = statusOrder[a.status] - statusOrder[b.status];
      if (orderDiff !== 0) return orderDiff;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.name.localeCompare(b.name);
    });
  }

  private notify(): void {
    this.version++;
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

export type { ConnectionState, ConnectionSnapshot, RequestRecord, ConnectionKind };
