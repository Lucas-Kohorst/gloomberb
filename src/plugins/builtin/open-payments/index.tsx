import type {
  GloomPlugin,
  PaneTemplateContext,
  PaneTemplateCreateOptions,
} from "../../../types/plugin";
import { registerConnectionSource } from "../connections/register";
import { OpenPaymentsPane } from "./pane";
import {
  OPEN_PAYMENTS_CONNECTION_ID,
  OPEN_PAYMENTS_PLUGIN_ID,
} from "./types";

function queryFromOptions(options?: PaneTemplateCreateOptions): string {
  return (options?.arg ?? options?.values?.query ?? "").trim();
}

function createPaymentsInstance(options?: PaneTemplateCreateOptions) {
  const query = queryFromOptions(options);
  const encoded = encodeURIComponent(query).replace(/%/g, "~");
  return {
    instanceId: query ? `payments:${encoded}` : "payments:latest",
    title: query ? `Open Payments ${query}` : "Open Payments",
    placement: "floating" as const,
    binding: { kind: "none" as const },
    settings: { query },
  };
}

let disposeConnection: (() => void) | null = null;

export const openPaymentsPlugin: GloomPlugin = {
  id: OPEN_PAYMENTS_PLUGIN_ID,
  name: "Open Payments",
  version: "1.0.0",
  description:
    "Search pharma and device payments to physicians and hospitals from CMS Open Payments. Free, no API key required.",
  toggleable: true,
  panes: [{
    id: "open-payments",
    name: "Open Payments",
    icon: "$",
    component: OpenPaymentsPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 100, height: 30 },
  }],
  paneTemplates: [{
    id: "open-payments-pane",
    paneId: "open-payments",
    label: "Open Payments",
    description:
      "Search pharma and device payments to physicians and hospitals by company, recipient, NPI, or state.",
    keywords: [
      "cms",
      "open",
      "payments",
      "pharma",
      "physician",
      "doctor",
      "drug",
      "manufacturer",
      "sunshine",
      "hospital",
      "transfers",
      "npi",
    ],
    category: "Data",
    shortcut: {
      prefix: "PAY",
      argPlaceholder: "company or physician",
      argKind: "text",
      argOptional: true,
    },
    createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
      return createPaymentsInstance(options);
    },
  }],
  setup() {
    disposeConnection = registerConnectionSource({
      id: OPEN_PAYMENTS_CONNECTION_ID,
      name: "CMS Open Payments",
      kind: "api",
      pluginId: OPEN_PAYMENTS_PLUGIN_ID,
      authRequired: false,
    });
  },
  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },
};

export default openPaymentsPlugin;
