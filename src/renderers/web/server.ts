import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { homedir } from "os";
import { basename, extname, join, resolve } from "path";
import { createAppServices, type AppServices } from "../../core/app-services";
import {
  exportConfig,
  getDataDir,
  importConfig,
  initDataDir,
  resetAllData,
  saveConfig,
  setConfigStoreHost,
} from "../../data/config/store";
import * as nodeConfigStoreHost from "../../data/config/store/node";
import { getDesktopBackendPlugins } from "../../plugins/catalog-backend";
import { createDesktopWorkspace } from "../electrobun/bun/desktop/workspace";
import { handleDesktopPluginStateRequest, loadDesktopPluginState } from "../electrobun/bun/desktop/plugin-state";
import { handleHttpFetch } from "../electrobun/bun/desktop/http-fetch";
import { resolveDesktopLiveStream } from "../electrobun/bun/desktop/media";
import type {
  DesktopBackendRequest,
  DesktopBackendRequestMethod,
  ElectrobunBackendInit,
} from "../electrobun/shared/protocol";
import { encodeRpcValue } from "../electrobun/view/rpc-codec";
import type { AppConfig } from "../../types/config";

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

interface RpcEnvelope {
  method?: DesktopBackendRequestMethod;
  payload?: unknown;
}

export interface LocalWebClientOptions {
  port?: number;
  publicDir?: string;
}

export async function startLocalWebClient(options: LocalWebClientOptions = {}): Promise<{ url: string; stop(): void }> {
  setConfigStoreHost(nodeConfigStoreHost);
  const publicDir = resolve(options.publicDir ?? join(process.cwd(), "dist", "web-client"));
  if (!existsSync(join(publicDir, "index.html"))) {
    throw new Error("Web client assets are missing. Run `bun run web:build` first.");
  }

  const sessionToken = await readWebSessionToken(publicDir);
  let config = await initDataDir(await getDataDir() ?? join(process.env.HOME || homedir(), ".gloomberb"));
  let services = createServices(config);
  await services.ready;
  let workspace = createDesktopWorkspace(config, null);
  const sockets = new Set<ServerWebSocket<undefined>>();
  const subscriptions = new Map<string, () => void>();

  const replaceServices = async (nextConfig: AppConfig) => {
    services.destroy();
    config = nextConfig;
    services = createServices(config);
    await services.ready;
    workspace = createDesktopWorkspace(config, null);
  };
  const setConfig = (nextConfig: AppConfig) => {
    config = nextConfig;
    services.pluginRegistry.getConfigFn = () => config;
    services.pluginRegistry.getLayoutFn = () => config.layout;
  };

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port ?? 0,
    fetch: async (request, serverInstance) => {
      const url = new URL(request.url);
      if (url.pathname === "/_gloomberb/events") {
        if (url.searchParams.get("token") !== sessionToken) return new Response("Unauthorized", { status: 401 });
        if (serverInstance.upgrade(request)) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      if (url.pathname === "/_gloomberb/rpc") {
        if (request.method !== "POST" || request.headers.get("authorization") !== `Bearer ${sessionToken}`) {
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        }
        try {
          const envelope = await request.json() as RpcEnvelope;
          const value = await handleRequest({
            method: envelope.method,
            payload: envelope.payload,
            config: () => config,
            services: () => services,
            setConfig,
            replaceServices,
            emitCapabilityEvent(subscriptionId, event) {
              const message = JSON.stringify(encodeRpcValue({ type: "capability.event", subscriptionId, event }));
              for (const socket of sockets) socket.send(message);
            },
            emitDesktopState(snapshot) {
              const message = JSON.stringify(encodeRpcValue({ type: "desktop.state", snapshot }));
              for (const socket of sockets) socket.send(message);
            },
            workspace: () => workspace,
            subscriptions,
          });
          return Response.json({ ok: true, value: encodeRpcValue(value) });
        } catch (error) {
          return Response.json({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }, { status: 400 });
        }
      }
      return serveAsset(url.pathname, publicDir);
    },
    websocket: {
      open(socket) {
        sockets.add(socket);
      },
      close(socket) {
        sockets.delete(socket);
      },
    },
  });

  const url = `http://${server.hostname}:${server.port}`;
  console.log(`Gloomberb web client: ${url}`);
  return {
    url,
    stop() {
      for (const unsubscribe of subscriptions.values()) unsubscribe();
      subscriptions.clear();
      services.destroy();
      server.stop(true);
    },
  };
}

function createServices(config: AppConfig): AppServices {
  return createAppServices({ config, plugins: getDesktopBackendPlugins() });
}

async function readWebSessionToken(publicDir: string): Promise<string> {
  const html = await readFile(join(publicDir, "index.html"), "utf8");
  const match = html.match(/__GLOOM_WEB_SESSION = "([^"]+)"/);
  if (!match?.[1]) throw new Error("Web client session token was not embedded in the build.");
  return match[1];
}

async function serveAsset(pathname: string, publicDir: string): Promise<Response> {
  const requested = pathname === "/" ? "index.html" : basename(pathname);
  const path = resolve(publicDir, requested);
  if (!path.startsWith(`${publicDir}/`) && path !== join(publicDir, "index.html")) {
    return new Response("Not found", { status: 404 });
  }
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(file, {
    headers: {
      "content-type": MIME_TYPES[extname(path)] ?? "application/octet-stream",
      "cache-control": path.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable",
    },
  });
}

async function handleRequest(options: {
  method: DesktopBackendRequest["method"] | undefined;
  payload: unknown;
  config(): AppConfig;
  services(): AppServices;
  setConfig(config: AppConfig): void;
  replaceServices(config: AppConfig): Promise<void>;
  emitCapabilityEvent(subscriptionId: string, event: unknown): void;
  emitDesktopState(snapshot: import("../../types/desktop-window").DesktopSharedStateSnapshot): void;
  workspace(): ReturnType<typeof createDesktopWorkspace>;
  subscriptions: Map<string, () => void>;
}): Promise<unknown> {
  const { method, payload, config, services, setConfig, replaceServices, emitCapabilityEvent, emitDesktopState, subscriptions, workspace } = options;
  if (!method) throw new Error("Missing backend request method.");
  const request = { method, payload } as DesktopBackendRequest;

  switch (request.method) {
    case "init": {
      const result: ElectrobunBackendInit = {
        config: config(),
        sessionSnapshot: null,
        desktopSnapshot: workspace().getSnapshot(),
        desktopThemePreview: null,
        pluginState: loadDesktopPluginState(services().pluginRegistry),
        capabilityManifests: services().pluginRegistry.capabilities.manifests({ rendererOnly: true }),
        desktopPlatform: process.platform,
        windowKind: "main",
      };
      return result;
    }
    case "http.fetch":
      return handleHttpFetch(request.payload);
    case "media.resolveLiveStream":
      return resolveDesktopLiveStream(request.payload);
    case "ticker.loadAll":
      return services().tickerRepository.loadAllTickers();
    case "ticker.load":
      return services().tickerRepository.loadTicker(request.payload.symbol);
    case "ticker.save":
      await services().tickerRepository.saveTicker(request.payload.ticker);
      return null;
    case "ticker.delete":
      await services().tickerRepository.deleteTicker(request.payload.symbol);
      return null;
    case "config.save":
      await saveConfig(request.payload.config);
      setConfig(request.payload.config);
      emitDesktopState(workspace().replaceConfig(request.payload.config, { layoutChanged: true }));
      return null;
    case "config.export":
      return exportConfig(request.payload.config, request.payload.destPath);
    case "config.import": {
      const imported = await importConfig(request.payload.dataDir, request.payload.srcPath);
      await replaceServices(imported);
      return imported;
    }
    case "config.resetAllData":
      return resetAllData(request.payload.dataDir);
    case "session.set":
      services().persistence.sessions.set(request.payload.sessionId, request.payload.value, request.payload.schemaVersion);
      return null;
    case "session.delete":
      services().persistence.sessions.delete(request.payload.sessionId);
      return null;
    case "capability.invoke":
      return services().pluginRegistry.capabilities.invoke(
        request.payload.capabilityId,
        request.payload.operationId,
        request.payload.payload,
        { renderer: true },
      );
    case "capability.subscribe": {
      subscriptions.get(request.payload.subscriptionId)?.();
      await services().pluginRegistry.capabilities.subscribe(
        request.payload.capabilityId,
        request.payload.operationId,
        request.payload.payload,
        (event) => emitCapabilityEvent(request.payload.subscriptionId, event),
        { renderer: true, subscriptionId: request.payload.subscriptionId },
      );
      subscriptions.set(request.payload.subscriptionId, () => {
        void services().pluginRegistry.capabilities.unsubscribe(request.payload.subscriptionId);
      });
      return null;
    }
    case "capability.unsubscribe":
      subscriptions.get(request.payload.subscriptionId)?.();
      subscriptions.delete(request.payload.subscriptionId);
      return null;
    case "desktop.syncMainState":
      emitDesktopState(workspace().syncMainState(request.payload.snapshot));
      return null;
    case "desktop.setThemePreview":
      return null;
    case "desktop.replaceDetachedPaneState":
      emitDesktopState(workspace().replaceDetachedPaneState(request.payload.paneId, request.payload.paneState));
      return null;
    case "desktop.popOutPane":
      emitDesktopState(workspace().popOutPane(request.payload.paneId, { x: 64, y: 48, width: 960, height: 680 }));
      return null;
    case "desktop.dockDetachedPane":
      emitDesktopState(workspace().dockDetachedPane(request.payload.paneId, request.payload.edge));
      return null;
    case "desktop.closeDetachedPane":
      emitDesktopState(workspace().closeDetachedPane(request.payload.paneId));
      return null;
    case "desktop.focusDetachedPane":
      return null;
    case "host.openExternal":
    case "host.copyText":
    case "host.copyPngImage":
    case "host.notify":
    case "host.focusWindow":
    case "host.exit":
    case "host.windowControl":
    case "host.restart":
    case "host.showContextMenu":
    case "update.start":
    case "remote.forward":
      return null;
    case "pluginState.set":
    case "pluginState.setMany":
    case "pluginState.delete":
      return handleDesktopPluginStateRequest(services().pluginRegistry.persistence.pluginState, request);
    case "host.readText":
      return "";
    case "update.check":
      return { available: false };
    default: {
      const exhaustive: never = request;
      throw new Error(`Unsupported browser backend method: ${String(exhaustive)}`);
    }
  }
}
