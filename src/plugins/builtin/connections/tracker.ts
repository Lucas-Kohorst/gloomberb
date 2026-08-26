import type { PluginCapability, RegisteredCapability } from "../../../capabilities/types";
import type { DataProvider } from "../../../types/data-provider";
import type { GloomPluginContext } from "../../../types/plugin";
import { apiClient } from "../../../api-client";
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
import { isAdjacentCloudChildSourceId } from "./adjacent-cloud";
import {
  listConnectionSources,
  setConnectionRequestReporter,
  subscribeConnectionSources,
} from "./register";

type ConnectionListener = (snapshot: ConnectionSnapshot) => void;

const CLOUD_SOCKET_ID = "gloom-cloud-ws";
const CLOUD_REST_ID = "gloom-cloud";
const POLL_INTERVAL_MS = 3000;
const NOTIFY_COALESCE_MS = 250;

/** Chat + Cloud market REST methods. DataProvider router traffic is not Cloud REST. */
const CLOUD_REST_OPS = [
  "getChannels",
  "getChatState",
  "getChatPresence",
  "getMessages",
  "sendMessage",
  "editMessage",
  "openDirectChannel",
  "openGroupChannel",
  "updateChatChannelState",
  "markChatNotificationsDelivered",
  "getCloudQuote",
  "getCloudQuotesBatch",
  "getCloudFinancials",
  "getCloudFinancialsBatch",
  "getCloudHistory",
  "getCloudHolders",
  "getCloudAnalystResearch",
  "getCloudCorporateActions",
  "getCloudOptionsChain",
  "getCloudExchangeRate",
  "getCloudMarketScreener",
  "getCloudProfile",
  "getCloudFundamentals",
  "getCloudStatements",
] as const;

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
  private readonly apiClientOriginals = new Map<string, (...args: unknown[]) => unknown>();
  private version = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private notifyHandle: { type: "raf"; id: number } | { type: "timeout"; id: ReturnType<typeof setTimeout> } | null = null;
  private notifyScheduled = false;
  private listCapabilities: (() => RegisteredCapability[]) | null = null;
  private disposers: Array<() => void> = [];
  private disposed = false;

  attach(_ctx: GloomPluginContext, listCapabilities: () => RegisteredCapability[], _marketData: DataProvider): void {
    this.listCapabilities = listCapabilities;

    this.ensureConnection(CLOUD_REST_ID, "Gloom Cloud", "asset-data", "gloomberb-cloud", 1, false, true);
    this.ensureConnection(CLOUD_SOCKET_ID, "Gloom Cloud Stream", "websocket", "gloomberb-cloud", 0, true, true);

    this.syncFromRegistry();
    this.wrapCloudRest();
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
    this.cancelScheduledNotify();
    this.unwrapCloudRest();
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

  private providerEntryFromCapability(capability: PluginCapability, pluginId: string): ProviderEntry | null {
    const id = capability.sourceId ?? capability.id;
    // Adjacent News / listings / polls capabilities share the Adjacent Cloud row.
    if (isAdjacentCloudChildSourceId(id)) return null;
    const kind = connectionKindFromCapability(capability.kind);
    return {
      id,
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
    if (this.states.has(id)) {
      const existing = this.states.get(id)!;
      let next = existing;
      if (authRequired !== undefined && existing.authRequired !== authRequired) {
        next = { ...next, authRequired };
      }
      if (authRequired === false && next.status === "idle") {
        next = { ...next, status: "connected" };
      }
      if (next === existing) return false;
      this.states.set(id, next);
      return true;
    }
    this.states.set(id, createInitialConnectionState(id, name, kind, pluginId, priority, isWebSocket, authRequired));
    return true;
  }

  // -- Cloud REST wrapping ---------------------------------------------------

  /** Cloud chat + market REST. DataProvider/Yahoo/IBKR traffic reports via register. */
  private wrapCloudRest(): void {
    const client = apiClient as unknown as Record<string, unknown>;
    const tracker = this;

    for (const op of CLOUD_REST_OPS) {
      const original = client[op];
      if (typeof original !== "function") continue;
      if (this.apiClientOriginals.has(op)) continue;
      const run = original as (...args: unknown[]) => Promise<unknown>;
      this.apiClientOriginals.set(op, run);
      client[op] = async function (...args: unknown[]): Promise<unknown> {
        const start = Date.now();
        try {
          const result = await run.apply(apiClient, args);
          tracker.recordSuccess(CLOUD_REST_ID, op, Date.now() - start);
          return result;
        } catch (error) {
          tracker.recordFailure(CLOUD_REST_ID, op, Date.now() - start, error);
          throw error;
        }
      };
    }
  }

  private unwrapCloudRest(): void {
    const client = apiClient as unknown as Record<string, unknown>;
    for (const [op, original] of this.apiClientOriginals) {
      client[op] = original;
    }
    this.apiClientOriginals.clear();
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
    if (this.disposed || this.notifyScheduled) return;
    this.notifyScheduled = true;
    const flush = () => {
      this.notifyHandle = null;
      this.notifyScheduled = false;
      if (this.disposed) return;
      this.version++;
      const snapshot = this.getSnapshot();
      for (const listener of this.listeners) {
        listener(snapshot);
      }
    };
    if (typeof requestAnimationFrame === "function") {
      this.notifyHandle = { type: "raf", id: requestAnimationFrame(flush) };
      return;
    }
    this.notifyHandle = { type: "timeout", id: setTimeout(flush, NOTIFY_COALESCE_MS) };
  }

  private cancelScheduledNotify(): void {
    if (!this.notifyHandle) {
      this.notifyScheduled = false;
      return;
    }
    if (this.notifyHandle.type === "raf") {
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(this.notifyHandle.id);
      }
    } else {
      clearTimeout(this.notifyHandle.id);
    }
    this.notifyHandle = null;
    this.notifyScheduled = false;
  }
}

export type { ConnectionState, ConnectionSnapshot, RequestRecord, ConnectionKind };
