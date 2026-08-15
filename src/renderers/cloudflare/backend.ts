import { createDefaultConfig, type AppConfig } from "../../types/config";
import { resolveHostedTvStream } from "../../plugins/builtin/tv/youtube-embed";
import type { LiveStreamResolveRequest } from "../../types/media";
import { handleHttpFetch, type SharedHttpFetchRequest } from "../electrobun/shared/http-fetch";
import { decodeRpcValue, encodeRpcValue } from "../electrobun/view/rpc-codec";
import { gloomFetch, readSessionCookie } from "./gloom-cloud";

/**
 * The hosted backend is a thin bootstrap layer over Gloom Cloud: the app's own
 * sync engine (renderer-side) owns config and collection persistence, so most
 * stateful RPCs are intentional no-ops here.
 */

export interface HostedUser {
  id: string;
  email?: string;
  name?: string;
  emailVerified?: boolean;
}

type HostedBackendRequest =
  | { method: "init"; payload: { kind?: "main" | "detached"; paneId?: string } }
  | { method: "http.fetch"; payload: SharedHttpFetchRequest }
  | { method: "ticker.loadAll"; payload: null }
  | { method: "ticker.load"; payload: { symbol: string } }
  | { method: "ticker.save"; payload: unknown }
  | { method: "ticker.delete"; payload: unknown }
  | { method: "config.save"; payload: unknown }
  | { method: "config.resetAllData"; payload: unknown }
  | { method: "config.export"; payload: unknown }
  | { method: "config.import"; payload: unknown }
  | { method: "session.set"; payload: unknown }
  | { method: "session.delete"; payload: unknown }
  | { method: "pluginState.set"; payload: unknown }
  | { method: "pluginState.setMany"; payload: unknown }
  | { method: "pluginState.delete"; payload: unknown }
  | { method: "capability.invoke"; payload: unknown }
  | { method: "capability.subscribe"; payload: unknown }
  | { method: "capability.unsubscribe"; payload: unknown }
  | { method: "desktop.syncMainState"; payload: unknown }
  | { method: "desktop.setThemePreview"; payload: unknown }
  | { method: "desktop.replaceDetachedPaneState"; payload: unknown }
  | { method: "desktop.popOutPane"; payload: unknown }
  | { method: "desktop.dockDetachedPane"; payload: unknown }
  | { method: "desktop.closeDetachedPane"; payload: unknown }
  | { method: "desktop.focusDetachedPane"; payload: unknown }
  | { method: "media.resolveLiveStream"; payload: unknown }
  | { method: "host.openExternal"; payload: unknown }
  | { method: "host.copyText"; payload: unknown }
  | { method: "host.copyPngImage"; payload: unknown }
  | { method: "host.notify"; payload: unknown }
  | { method: "host.focusWindow"; payload: unknown }
  | { method: "host.exit"; payload: unknown }
  | { method: "host.windowControl"; payload: unknown }
  | { method: "host.restart"; payload: unknown }
  | { method: "host.showContextMenu"; payload: unknown }
  | { method: "host.readText"; payload: unknown }
  | { method: "update.check"; payload: unknown }
  | { method: "update.start"; payload: unknown }
  | { method: "remote.forward"; payload: unknown };

const NOT_AVAILABLE = "Not available in the hosted client yet.";

export async function handleHostedBackendRpc(env: Env, user: HostedUser | null, request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed." }, { status: 405 });
  }
  let envelope: { method?: string; payload?: unknown };
  try {
    envelope = decodeRpcValue(await request.json());
  } catch {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  if (!envelope.method) {
    return Response.json({ ok: false, error: "Missing backend request method." }, { status: 400 });
  }
  try {
    const value = await dispatch(env, user, request, envelope as HostedBackendRequest);
    return Response.json({ ok: true, value: encodeRpcValue(value ?? null) });
  } catch (error) {
    console.error(JSON.stringify({
      event: "cloud_backend_error",
      method: envelope.method,
      userId: user?.id ?? null,
      message: error instanceof Error ? error.message : String(error),
    }));
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Hosted request failed.",
    }, { status: 400 });
  }
}

function resolveHostedMediaStream(payload: unknown): Promise<unknown> {
  const request = payload && typeof payload === "object" ? payload as LiveStreamResolveRequest : null;
  if (!request || request.provider !== "youtube" || typeof request.sourceId !== "string") {
    throw new Error("Unsupported live-stream provider.");
  }
  return resolveHostedTvStream(request.sourceId);
}

function hostedConfig(user: HostedUser | null): AppConfig {
  const config = createDefaultConfig(`cloud://users/${user?.id ?? "anonymous"}`);
  if (user) config.onboardingComplete = true;
  return config;
}

async function dispatch(
  env: Env,
  user: HostedUser | null,
  rawRequest: Request,
  request: HostedBackendRequest,
): Promise<unknown> {
  switch (request.method) {
    case "init":
      return {
        config: hostedConfig(user),
        sessionSnapshot: null,
        desktopSnapshot: null,
        desktopThemePreview: null,
        pluginState: user ? {
          "gloomberb-cloud": {
            session: {
              sessionToken: "hosted-session",
              user,
            },
          },
        } : {},
        capabilityManifests: [],
        desktopPlatform: "cloud",
        windowKind: request.payload?.kind === "detached" ? "detached" : "main",
        paneId: request.payload?.paneId,
      };
    case "http.fetch": {
      // Cloud API calls get the user's Gloom Cloud session attached; anything
      // else is proxied untouched, mirroring the desktop http.fetch contract.
      const url = typeof request.payload?.url === "string" ? request.payload.url : "";
      if (url.startsWith("https://api.gloom.sh/")) {
        const token = readSessionCookie(rawRequest);
        if (!token) throw new Error("Authentication required.");
        const upstream = await gloomFetch(env, url.slice("https://api.gloom.sh".length), {
          method: request.payload.init?.method,
          body: request.payload.init?.body ?? null,
          token,
        });
        const headers: Record<string, string> = {};
        upstream.headers.forEach((value, key) => {
          headers[key] = value;
        });
        return {
          status: upstream.status,
          statusText: upstream.statusText,
          headers,
          setCookie: upstream.headers.getSetCookie?.() ?? [],
          body: await upstream.text(),
        };
      }
      return handleHttpFetch(request.payload);
    }
    case "ticker.loadAll":
      return [];
    case "ticker.load":
      return null;
    case "ticker.save":
    case "ticker.delete":
    case "config.save":
    case "session.set":
    case "session.delete":
    case "pluginState.set":
    case "pluginState.setMany":
    case "pluginState.delete":
      // Persistence is owned by Gloom Cloud sync on the renderer side.
      return null;
    case "config.resetAllData":
    case "config.export":
    case "config.import":
      throw new Error(`Config file management is ${NOT_AVAILABLE.toLowerCase()}`);
    case "capability.invoke":
      throw new Error(`Hosted data capabilities are ${NOT_AVAILABLE.toLowerCase()}`);
    case "capability.subscribe":
    case "capability.unsubscribe":
      return null;
    case "desktop.syncMainState":
    case "desktop.setThemePreview":
    case "desktop.replaceDetachedPaneState":
    case "desktop.popOutPane":
    case "desktop.dockDetachedPane":
    case "desktop.closeDetachedPane":
    case "desktop.focusDetachedPane":
      return null;
    case "media.resolveLiveStream":
      return resolveHostedMediaStream(request.payload);
    case "host.openExternal":
    case "host.copyText":
    case "host.copyPngImage":
    case "host.notify":
    case "host.focusWindow":
    case "host.exit":
    case "host.windowControl":
    case "host.restart":
    case "update.start":
    case "remote.forward":
      return null;
    case "host.showContextMenu":
      return false;
    case "host.readText":
      return "";
    case "update.check":
      return { available: false };
    default: {
      const exhaustive: never = request;
      throw new Error(`Unsupported hosted backend method: ${String(exhaustive)}`);
    }
  }
}
