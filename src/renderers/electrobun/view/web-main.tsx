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

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing root element");

const root = createRoot(rootElement);
const bootLog = debugLog.createLogger("web-client-boot");
root.render(<div className="gloom-loading">Starting Gloomberb...</div>);

function renderFatalError(error: unknown): void {
  root.render(<DesktopFatalScreen title="Gloomberb failed to start" error={error} source="web-client" />);
}

async function boot(): Promise<void> {
  installElectrobunConfigStoreHost();
  installElectrobunBrokerRemoteClient();
  installElectrobunHttpFetchTransport();
  installElectrobunCloudApiFetchTransport();
  const init = await measurePerfAsync("startup.web-client.backend-init", () => initElectrobunBackend());
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
