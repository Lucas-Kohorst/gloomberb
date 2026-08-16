/** @jsxImportSource react */
import { createRoot } from "react-dom/client";
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
import {
  hydrateHostedUserConfig,
  setHostedConfigUserId,
} from "../../../data/config/hosted-user-persist";
import { apiClient, type PersistedAuthUser } from "../../../api-client";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing root element");

declare global {
  interface Window {
    __GLOOM_CLOUD_HOSTED?: boolean;
    __GLOOM_CLOUD_AUTHENTICATED?: boolean;
  }
}

const root = createRoot(rootElement);
const bootLog = debugLog.createLogger("web-client-boot");
root.render(<div className="gloom-loading">Starting Gloomberb...</div>);
const isHosted = window.__GLOOM_CLOUD_HOSTED === true;

function renderFatalError(error: unknown): void {
  root.render(<DesktopFatalScreen title="Gloomberb failed to start" error={error} source="web-client" />);
}

async function boot(): Promise<void> {
  installElectrobunConfigStoreHost();
  installElectrobunBrokerRemoteClient();
  installElectrobunHttpFetchTransport();
  if (isHosted) {
    installHostedCloudApiFetchTransport();
    const response = await fetch("/api/auth/session", { credentials: "include" });
    const session = await response.json() as { user?: PersistedAuthUser | null };
    window.__GLOOM_CLOUD_AUTHENTICATED = !!session.user;
    apiClient.setSessionToken(session.user ? "hosted-session" : null);
    apiClient.restoreCachedUser(session.user ?? null);
    setHostedConfigUserId(session.user?.id ?? null);
  } else {
    installElectrobunCloudApiFetchTransport();
  }
  const init = await measurePerfAsync("startup.web-client.backend-init", () => initElectrobunBackend());
  if (isHosted) {
    hydrateHostedUserConfig(init.config);
    hydrateHostedByokConfig(init.config);
  }
  installElectrobunAiHost();
  applyLanguageFromConfig(init.config);
  const paneId = new URLSearchParams(window.location.search).get("paneId") ?? undefined;
  const windowKind = paneId ? "detached" : "main";
  const desktopWindowBridge = createWebWindowBridge(windowKind, paneId);
  const desktopDeepLinkBridge = createWebDeepLinkBridge();
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
                onboardingInitialStep={isHosted ? "account" : undefined}
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
