import {
  GLOOM_CLOUD_FRED_CONNECTION_ID,
  GLOOM_CLOUD_HTTP_CONNECTION_ID,
  GLOOM_CLOUD_SOCKET_CONNECTION_ID,
} from "../../../core/connection-health";
import { registerConnectionSource } from "../connections/register";

/**
 * Publish Gloom Cloud HTTP / socket / FRED into the Connections inventory.
 * API-client `health.track` still uses `registerGloomCloudConnectionSources`
 * for early TUI requests; this path is what hosted/Electrobun and CONN list.
 */
export function registerGloomCloudInventorySources(): () => void {
  const disposers = [
    registerConnectionSource({
      id: GLOOM_CLOUD_HTTP_CONNECTION_ID,
      name: "Gloom Cloud HTTP",
      kind: "api",
      pluginId: "gloomberb-cloud",
      priority: 0,
      authRequired: true,
    }),
    registerConnectionSource({
      id: GLOOM_CLOUD_SOCKET_CONNECTION_ID,
      name: "Gloom Cloud Stream",
      kind: "websocket",
      pluginId: "gloomberb-cloud",
      priority: 1,
      isWebSocket: true,
      authRequired: true,
    }),
    registerConnectionSource({
      id: GLOOM_CLOUD_FRED_CONNECTION_ID,
      name: "Gloom / FRED",
      kind: "api",
      pluginId: "macro",
      priority: 2,
      authRequired: true,
    }),
  ];
  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };
}
