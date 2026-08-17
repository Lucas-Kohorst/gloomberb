import type {
  ApplicationMenuSelectMessage,
  CapabilityEventMessage,
  ContextMenuSelectMessage,
  DesktopBackendRequestArgs,
  DesktopBackendRequestMethod,
  DesktopBackendRequestPayload,
  DesktopBackendRequestResponse,
  DesktopDockPreviewMessage,
  DesktopRestartMessage,
  DesktopStateMessage,
  DesktopThemePreviewMessage,
  ElectrobunBackendInit,
  UpdateProgressMessage,
} from "../shared/protocol";
import { decodeRpcValue, encodeRpcValue } from "./rpc-codec";
import type { RemoteControlRequest, RemoteControlResponse } from "../../../remote/types";

declare global {
  interface Window {
    __GLOOM_WEB_SESSION?: string;
  }
}

type Listener<T> = (message: T) => void;
type CapabilityEventListener = (message: CapabilityEventMessage) => void;

let initSnapshot: ElectrobunBackendInit | null = null;
let socket: WebSocket | null = null;
const capabilityEventListeners = new Map<string, Set<CapabilityEventListener>>();
const desktopStateListeners = new Set<(message: DesktopStateMessage) => void>();
const HOSTED_RPC_PATH = "/_gloomberb/rpc?transport=2";

function sessionToken(): string {
  const token = window.__GLOOM_WEB_SESSION;
  if (!token) throw new Error("The local Gloomberb web session is unavailable. Reload the page.");
  return token;
}

async function request<T>(method: DesktopBackendRequestMethod, payload: unknown): Promise<T> {
  const response = await fetch(HOSTED_RPC_PATH, {
    method: "POST",
    cache: "no-store",
    headers: {
      authorization: `Bearer ${sessionToken()}`,
      "cache-control": "no-store",
      "content-type": "application/json",
    },
    body: JSON.stringify({ method, payload: encodeRpcValue(payload) }),
  });
  const body = await response.json() as { ok: boolean; value?: unknown; error?: string };
  if (!response.ok || !body.ok) throw new Error(body.error || "Local Gloomberb request failed.");
  return decodeRpcValue<T>(body.value);
}

function ensureSocket(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/_gloomberb/events?token=${encodeURIComponent(sessionToken())}`);
  socket.addEventListener("message", (event) => {
    const message = decodeRpcValue<{ type?: string; subscriptionId?: string; event?: unknown; snapshot?: DesktopStateMessage["snapshot"] }>(JSON.parse(String(event.data)));
    if (message.type === "desktop.state" && message.snapshot) {
      for (const listener of desktopStateListeners) listener({ snapshot: message.snapshot });
      return;
    }
    if (message.type === "capability.event" && message.subscriptionId) {
      const capabilityEvent = { subscriptionId: message.subscriptionId, event: message.event };
      for (const listener of capabilityEventListeners.get(capabilityEvent.subscriptionId) ?? []) {
        listener(capabilityEvent);
      }
    }
  });
}

function subscribe<T>(listeners: Map<string, Set<(value: T) => void>>, key: string, listener: (value: T) => void): () => void {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)!.add(listener);
  return () => {
    const entries = listeners.get(key);
    entries?.delete(listener);
    if (entries?.size === 0) listeners.delete(key);
  };
}

export function backendRequest<T = unknown>(
  method: "capability.invoke",
  payload: DesktopBackendRequestPayload<"capability.invoke">,
): Promise<T>;
export function backendRequest<K extends Exclude<DesktopBackendRequestMethod, "capability.invoke">>(
  method: K,
  ...args: DesktopBackendRequestArgs<K>
): Promise<DesktopBackendRequestResponse<K>>;
export async function backendRequest(
  method: DesktopBackendRequestMethod,
  payload: unknown = null,
): Promise<unknown> {
  return request(method, payload);
}

export async function initElectrobunBackend(payload?: { kind?: "main" | "detached"; paneId?: string }): Promise<ElectrobunBackendInit> {
  initSnapshot = await request("init", payload ?? {});
  ensureSocket();
  return initSnapshot;
}

export function requestElectrobunRestart(_message: DesktopRestartMessage = {}): void {
  window.location.reload();
}

export function getElectrobunBackendInitSnapshot(): ElectrobunBackendInit | null {
  return initSnapshot;
}

export function onCapabilityEvent(subscriptionId: string, listener: CapabilityEventListener): () => void {
  ensureSocket();
  return subscribe(capabilityEventListeners, subscriptionId, listener);
}

function unsubscribe(): () => void {
  return () => {};
}

export function onContextMenuSelect(_requestId: string, _listener: Listener<ContextMenuSelectMessage>): () => void {
  return unsubscribe();
}

export function onApplicationMenuSelect(_listener: Listener<ApplicationMenuSelectMessage>): () => void {
  return unsubscribe();
}

export function onDesktopDeepLink(_listener: Listener<{ url: string }>): () => void {
  return unsubscribe();
}

export function onDesktopState(listener: Listener<DesktopStateMessage>): () => void {
  ensureSocket();
  desktopStateListeners.add(listener);
  return () => {
    desktopStateListeners.delete(listener);
  };
}

export function onDesktopDockPreview(_listener: Listener<DesktopDockPreviewMessage>): () => void {
  return unsubscribe();
}

export function onDesktopThemePreview(_listener: Listener<DesktopThemePreviewMessage>): () => void {
  return unsubscribe();
}

export function onUpdateProgress(_listener: Listener<UpdateProgressMessage>): () => void {
  return unsubscribe();
}

export function setElectrobunRemoteRequestHandler(
  _handler: (request: RemoteControlRequest) => Promise<RemoteControlResponse>,
): () => void {
  return unsubscribe();
}
