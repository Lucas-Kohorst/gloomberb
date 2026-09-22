import type {
  GloomPlugin,
  GloomPluginContext,
  PaneTemplateContext,
  PaneTemplateCreateOptions,
} from "../../../types/plugin";
import { registerConnectionSource } from "../connections/register";
import { setBravadoCredentialResolvers } from "./client";
import { UmaDisputesPane } from "./pane";
import {
  BRAVADO_API_KEY_ENV,
  BRAVADO_API_ORIGIN,
  BRAVADO_API_SECRET_ENV,
  BRAVADO_UMA_BYOK_SERVICE_ID,
  BRAVADO_UMA_SECRET_SERVICE_ID,
  UMA_CONNECTION_ID,
  UMA_DISPUTES_PANE_ID,
  UMA_DISPUTES_PLUGIN_ID,
} from "./types";

function queryFromOptions(options?: PaneTemplateCreateOptions): string {
  return (options?.arg ?? options?.values?.query ?? "").trim();
}

function createDisputesInstance(options?: PaneTemplateCreateOptions) {
  const query = queryFromOptions(options);
  const encoded = encodeURIComponent(query).replace(/%/g, "~");
  return {
    instanceId: query ? `uma-disputes:${encoded}` : "uma-disputes:latest",
    title: query ? `Disputes ${query}` : "Disputes",
    placement: "floating" as const,
    binding: { kind: "none" as const },
    settings: { query },
  };
}

let disposeConnection: (() => void) | null = null;

export const umaDisputesPlugin: GloomPlugin = {
  id: UMA_DISPUTES_PLUGIN_ID,
  name: "UMA Disputes",
  version: "1.0.0",
  description:
    "Polymarket UMA Optimistic Oracle disputes from the Bravado UMA API: open challenges and recently settled disputed markets.",
  toggleable: true,

  panes: [{
    id: UMA_DISPUTES_PANE_ID,
    name: "Disputes",
    icon: "U",
    component: UmaDisputesPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 112, height: 30 },
    tableExport: true,
  }],

  paneTemplates: [{
    id: "uma-disputes-pane",
    paneId: UMA_DISPUTES_PANE_ID,
    label: "UMA Disputes",
    description:
      "List Polymarket UMA Optimistic Oracle disputes: market, proposed answer, disputer, and whether the challenge is still open.",
    keywords: ["uma", "dispute", "disputes", "polymarket", "oracle", "resolution", "bravado", "optimistic"],
    category: "Data",
    shortcut: {
      prefix: "UMA",
      argPlaceholder: "market or question",
      argKind: "text",
      argOptional: true,
    },
    createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
      return createDisputesInstance(options);
    },
  }],

  setup(ctx: GloomPluginContext) {
    ctx.registerByokService({
      id: BRAVADO_UMA_BYOK_SERVICE_ID,
      name: "Bravado UMA",
      apiUrl: BRAVADO_API_ORIGIN,
      authType: "header",
      authKey: "X-BRAVADO-API-KEY",
      envVar: BRAVADO_API_KEY_ENV,
      description: "Public Bravado API key for UMA resolution data. Pair it with the HMAC secret. The key stays on this device.",
    });
    ctx.registerByokService({
      id: BRAVADO_UMA_SECRET_SERVICE_ID,
      name: "Bravado UMA secret",
      authType: "none",
      envVar: BRAVADO_API_SECRET_ENV,
      description: "HMAC secret for the Bravado UMA key. Stays on this device and is not synced.",
    });
    setBravadoCredentialResolvers({
      key: () => ctx.getApiKey(BRAVADO_UMA_BYOK_SERVICE_ID),
      secret: () => ctx.getApiKey(BRAVADO_UMA_SECRET_SERVICE_ID),
    });
    disposeConnection = registerConnectionSource({
      id: UMA_CONNECTION_ID,
      name: "Bravado UMA",
      kind: "api",
      pluginId: UMA_DISPUTES_PLUGIN_ID,
      authRequired: true,
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
    setBravadoCredentialResolvers(null);
  },
};

export default umaDisputesPlugin;
