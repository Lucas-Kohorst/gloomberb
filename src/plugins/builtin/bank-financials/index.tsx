import type { GloomPlugin, PaneTemplateCreateOptions } from "../../../types/plugin";
import { bankFinancialsHeadless } from "./headless";
import { BankFinancialsPane } from "./pane";
import { BANK_FINANCIALS_PANE_ID } from "./model";

function createBankPaneInstance(options?: PaneTemplateCreateOptions) {
  const query = (options?.arg ?? options?.values?.query ?? "").trim();
  const encoded = encodeURIComponent(query).replace(/%/g, "~");
  return {
    instanceId: query ? `bank-financials:${encoded}` : "bank-financials",
    placement: "floating" as const,
    binding: { kind: "none" as const },
    settings: { query },
  };
}

export const bankFinancialsPlugin: GloomPlugin = {
  id: "bank-financials",
  name: "Bank Balance Sheets",
  version: "1.0.0",
  description: "Assets and deposits of the largest active US banks, in billions.",
  toggleable: true,

  // Public JSON over HTTPS, so every renderer. The host is declared so the web app proxies it.
  targets: ["cli", "tui", "desktop", "web"],
  hosts: ["banks.data.fdic.gov"],

  panes: [
    {
      id: BANK_FINANCIALS_PANE_ID,
      name: "Bank Balance Sheets",
      icon: "B",
      component: BankFinancialsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 96, height: 28 },
      tableExport: true,
      headless: bankFinancialsHeadless,
    },
  ],

  paneTemplates: [
    {
      id: "bank-financials-pane",
      paneId: BANK_FINANCIALS_PANE_ID,
      label: "Bank Balance Sheets",
      description: "Assets and deposits of the largest active US banks, in billions. A name filters the list.",
      keywords: ["bank", "banks", "balance sheet", "assets", "deposits", "call report"],
      shortcut: {
        prefix: "BANK",
        argKind: "text",
        argPlaceholder: "name",
        argOptional: true,
      },
      headless: bankFinancialsHeadless,
      createInstance: (_context, options) => createBankPaneInstance(options),
    },
  ],
};
