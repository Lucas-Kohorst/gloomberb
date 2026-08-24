/** @jsxImportSource react */
import { createRoot } from "react-dom/client";
import { isHostedWebClient } from "../../../shared/hosted-api";
import { App } from "../../../app";
import { applyLanguageFromConfig } from "../../../i18n";
import { UiHostProvider } from "../../../ui/host";
import { debugLog } from "../../../utils/debug-log";
import { measurePerfAsync } from "../../../utils/perf-marks";
import { initElectrobunBackend } from "./backend-rpc";
import { installElectrobunAiHost } from "./ai-host";
import { installElectrobunBrokerRemoteClient } from "./broker-remote-client";
import { installElectrobunConfigStoreHost } from "./config-host";
import { WebDialogHostProvider } from "./dialog-host";
import {
  installElectrobunCloudApiFetchTransport,
  installElectrobunHttpFetchTransport,
  installHostedCloudApiFetchTransport,
} from "./http-fetch";
import { DesktopFatalScreen, ElectrobunErrorBoundary } from "./fatal-screen";
import { WebInputHostProvider } from "./input-host";
import { webNativeRenderer } from "./native-renderer";
import { WebToastHostProvider } from "./toast-host";
import { webUiHost } from "./ui-host";
import { createElectrobunAppServices } from "./app-services";
import { localWebRendererHost } from "./web-client-host";
import { createWebWindowBridge } from "./web-window-bridge";
import { createWebDeepLinkBridge } from "./web-deeplink-bridge";
import { hydrateHostedByokConfig } from "../../../plugins/builtin/byok/hosted-persist";
import { isPublicShareLocation } from "../../../plugins/builtin/shared/share-link";
import {
  getHostedConfigUserId,
  hydrateHostedUserConfig,
  readLastHostedUserId,
  rememberHostedUserId,
  setHostedConfigUserId,
} from "../../../data/config/hosted-user-persist";
import { apiClient } from "../../../api-client";
import {
  createHostedFallbackInit,
  resolveHostedInit,
  resolveHostedSession,
} from "./hosted-boot";
import { hydrateHostedWorkspaceFromCloud, restoreHostedLocalWorkspaceExtras } from "../../../data/config/hosted-sync-hydrate";
import { getHostedConfigSnapshotPusher } from "../../../data/config/hosted-config-snapshot";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing root element");

declare global {
  interface Window {
    __GLOOM_CLOUD_HOSTED?: boolean;
    __GLOOM_CLOUD_AUTHENTICATED?: boolean;
    /** Booted without a confirmed Gloom Cloud session or backend snapshot. */
    __GLOOM_CLOUD_DEGRADED?: boolean;
  }
}

const root = createRoot(rootElement);
const bootLog = debugLog.createLogger("web-client-boot");
root.render(<div className="gloom-loading">Starting Gloomberb...</div>);
const isHosted = isHostedWebClient();

/**
 * A boot still waiting on Gloom Cloud is indistinguishable from a frozen app,
 * so say what it is waiting for once the wait becomes noticeable.
 */
const slowBootNotice = isHosted
  ? setTimeout(() => {
    root.render(<div className="gloom-loading">Waiting for Gloom Cloud...</div>);
  }, 2_500)
  : undefined;

function stopSlowBootNotice(): void {
  if (slowBootNotice !== undefined) clearTimeout(slowBootNotice);
}

function renderFatalError(error: unknown): void {
  stopSlowBootNotice();
  root.render(<DesktopFatalScreen title="Gloomberb failed to start" error={error} source="web-client" />);
}

async function boot(): Promise<void> {
  installElectrobunConfigStoreHost();
  installElectrobunBrokerRemoteClient();
  installElectrobunHttpFetchTransport();
  let degraded = false;
  let hostedSession: Awaited<ReturnType<typeof resolveHostedSession>> | null = null;
  if (isHosted) {
    installHostedCloudApiFetchTransport();
    // Route the realtime socket through the Worker's own origin so it relays to
    // Gloom Cloud with the server-held session; the browser only ever holds the
    // opaque hosted-session cookie.
    apiClient.setHostedSocketBaseUrl(window.location.origin);
    hostedSession = await resolveHostedSession(fetch);
    degraded = hostedSession.degraded;
    window.__GLOOM_CLOUD_AUTHENTICATED = !!hostedSession.user;
    apiClient.setSessionToken(hostedSession.user ? "hosted-session" : null);
    apiClient.restoreCachedUser(hostedSession.user ?? null);
    if (hostedSession.user) {
      rememberHostedUserId(hostedSession.user.id);
      setHostedConfigUserId(hostedSession.user.id);
    } else if (hostedSession.degraded) {
      // Gloom Cloud never answered. Keep the last user's config so a slow
      // upstream does not look like a wiped account, but leave the api client
      // unauthenticated so nothing syncs against an unverified session.
      bootLog.warn("session check failed; booting degraded");
      setHostedConfigUserId(readLastHostedUserId());
    } else {
      rememberHostedUserId(null);
      setHostedConfigUserId(null);
    }
  } else {
    installElectrobunCloudApiFetchTransport();
  }
  const paneId = new URLSearchParams(window.location.search).get("paneId") ?? undefined;
  const windowKind = paneId ? "detached" : "main";
  const hostedFallbackInit = () => createHostedFallbackInit({
    userId: getHostedConfigUserId(),
    windowKind,
    paneId,
  });
  const resolved = await measurePerfAsync("startup.web-client.backend-init", () => {
    if (!isHosted) return initElectrobunBackend().then((init) => ({ init, degraded: false }));
    // The hosted init RPC re-resolves the session upstream. Once the session is
    // already known to be unreachable, asking again only doubles the wait for a
    // snapshot this can build locally.
    if (degraded) return Promise.resolve({ init: hostedFallbackInit(), degraded: true });
    return resolveHostedInit(
      () => initElectrobunBackend({ kind: windowKind, paneId }),
      hostedFallbackInit,
    );
  });
  const init = resolved.init;
  if (resolved.degraded) {
    degraded = true;
    bootLog.warn("backend init timed out; booting from local config");
  }
  if (isHosted) {
    const publicShare = isPublicShareLocation();
    hydrateHostedByokConfig(init.config);
    if (!publicShare) {
      hydrateHostedUserConfig(init.config);
      restoreHostedLocalWorkspaceExtras();
      getHostedConfigSnapshotPusher().schedule(init.config);
      // Overlay per-user localStorage, Worker `/api/config`, and Gloom Cloud
      // `/sync/snapshot` before the first render so Main Portfolio and the saved
      // default layout are already in the boot config. Worker ticker RPCs stay
      // no-ops; the book lives in hosted ticker persist + sync.
      if (hostedSession?.user) {
        try {
          await hydrateHostedWorkspaceFromCloud(init.config, {
            pullSync: () => apiClient.getSyncSnapshot(),
          });
          getHostedConfigSnapshotPusher().schedule(init.config);
        } catch {
          // Network or parse failure — proceed with whatever local hydration gave us.
        }
      }
    }
  }
  window.__GLOOM_CLOUD_DEGRADED = degraded;
  installElectrobunAiHost();
  applyLanguageFromConfig(init.config);
  const desktopWindowBridge = createWebWindowBridge(windowKind, paneId);
  const desktopDeepLinkBridge = createWebDeepLinkBridge();
  stopSlowBootNotice();
  root.render(
    <ElectrobunErrorBoundary>
      <UiHostProvider ui={webUiHost} renderer={localWebRendererHost} nativeRenderer={webNativeRenderer}>
        <WebInputHostProvider>
          <WebToastHostProvider>
            <WebDialogHostProvider>
              <App
                config={init.config}
                servicesFactory={createElectrobunAppServices}
                desktopWindowBridge={desktopWindowBridge}
                desktopDeepLinkBridge={desktopDeepLinkBridge}
                desktopSnapshot={init.desktopSnapshot}
                requireAccount={isHosted}
              />
            </WebDialogHostProvider>
          </WebToastHostProvider>
        </WebInputHostProvider>
      </UiHostProvider>
    </ElectrobunErrorBoundary>,
  );
  bootLog.info("web client started");
}

boot().catch(renderFatalError);
