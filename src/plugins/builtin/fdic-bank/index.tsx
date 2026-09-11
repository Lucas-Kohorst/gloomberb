import type {
  GloomPlugin,
  PaneTemplateContext,
  PaneTemplateCreateOptions,
} from "../../../types/plugin";
import { registerConnectionSource } from "../connections/register";
import { FdicBankPane } from "./pane";
import { FDIC_BANK_CONNECTION_ID, FDIC_BANK_PLUGIN_ID } from "./types";

function queryFromOptions(options?: PaneTemplateCreateOptions): string {
  return (options?.arg ?? options?.values?.query ?? "").trim();
}

function createBankRiskInstance(options?: PaneTemplateCreateOptions) {
  const query = queryFromOptions(options);
  const encoded = encodeURIComponent(query).replace(/%/g, "~");
  return {
    instanceId: query ? `fdic-bank:${encoded}` : "fdic-bank:latest",
    title: query ? `Bank Risk ${query}` : "Bank Risk",
    placement: "floating" as const,
    binding: { kind: "none" as const },
    settings: { query },
  };
}

let disposeConnection: (() => void) | null = null;

export const fdicBankPlugin: GloomPlugin = {
  id: FDIC_BANK_PLUGIN_ID,
  name: "FDIC Bank Risk",
  version: "1.0.0",
  description:
    "FDIC bank risk: search insured banks by name, certificate, or state, with failure and assistance records from the free BankFind API.",
  toggleable: true,

  panes: [
    {
      id: "fdic-bank",
      name: "Bank Risk",
      icon: "F",
      component: FdicBankPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
    },
  ],

  paneTemplates: [
    {
      id: "fdic-bank-pane",
      paneId: "fdic-bank",
      label: "Bank Risk",
      description:
        "Search FDIC-insured banks and failure records by bank name, certificate number, state, or failure year.",
      keywords: [
        "fdic",
        "bank",
        "banks",
        "failure",
        "failures",
        "enforcement",
        "risk",
        "certificate",
        "cert",
        "deposit",
        "closure",
      ],
      category: "Data",
      shortcut: {
        prefix: "FDIC",
        argPlaceholder: "bank name, CERT, or state",
        argKind: "text",
        argOptional: true,
      },
      createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
        return createBankRiskInstance(options);
      },
    },
  ],

  setup() {
    disposeConnection = registerConnectionSource({
      id: FDIC_BANK_CONNECTION_ID,
      name: "FDIC BankFind",
      kind: "api",
      pluginId: FDIC_BANK_PLUGIN_ID,
      priority: 650,
      authRequired: false,
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },
};

export default fdicBankPlugin;
