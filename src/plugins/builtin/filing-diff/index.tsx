import type {
  GloomPlugin,
  PaneTemplateContext,
  PaneTemplateCreateOptions,
} from "../../../types/plugin";
import { registerConnectionSource } from "../connections/register";
import { FilingDiffPane } from "./pane";
import {
  FILING_DIFF_CONNECTION_ID,
  FILING_DIFF_PANE_ID,
  FILING_DIFF_PLUGIN_ID,
  FILING_DIFF_SECTIONS,
  FILING_DIFF_TEMPLATE_ID,
} from "./types";

function tickerFromOptions(options?: PaneTemplateCreateOptions): string {
  const raw = options?.arg
    ?? options?.symbol
    ?? options?.ticker?.metadata.ticker
    ?? options?.values?.ticker
    ?? "";
  return String(raw ?? "").trim().toUpperCase();
}

function createFilingDiffInstance(options?: PaneTemplateCreateOptions) {
  const ticker = tickerFromOptions(options);
  const encoded = encodeURIComponent(ticker).replace(/%/g, "~");
  return {
    instanceId: ticker ? `${FILING_DIFF_PANE_ID}:${encoded}` : `${FILING_DIFF_PANE_ID}:latest`,
    title: ticker ? `DIFF ${ticker}` : "Filing Diff",
    placement: "floating" as const,
    binding: { kind: "none" as const },
    settings: {
      ticker,
      baseYear: "",
      compareYear: "",
      section: "risk-factors",
    },
  };
}

let disposeConnection: (() => void) | null = null;

export const filingDiffPlugin: GloomPlugin = {
  id: FILING_DIFF_PLUGIN_ID,
  name: "Filing Diff",
  version: "1.0.0",
  description:
    "Year-over-year 10-K diff: compare Risk Factors or MD&A text between two annual filings.",
  toggleable: true,

  panes: [
    {
      id: FILING_DIFF_PANE_ID,
      name: "Filing Diff",
      icon: "D",
      component: FilingDiffPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
      settings: {
        title: "Filing Diff Settings",
        fields: [
          {
            key: "ticker",
            label: "Ticker",
            type: "text",
            placeholder: "AAPL",
          },
          {
            key: "baseYear",
            label: "Base year",
            description: "Filing year of the older 10-K.",
            type: "text",
            placeholder: "2023",
          },
          {
            key: "compareYear",
            label: "Compare year",
            description: "Filing year of the newer 10-K.",
            type: "text",
            placeholder: "2024",
          },
          {
            key: "section",
            label: "Section",
            type: "select",
            options: FILING_DIFF_SECTIONS.map((entry) => ({
              value: entry.value,
              label: entry.label,
            })),
          },
        ],
      },
    },
  ],

  paneTemplates: [
    {
      id: FILING_DIFF_TEMPLATE_ID,
      paneId: FILING_DIFF_PANE_ID,
      label: "Filing Diff",
      description:
        "Diff a company's 10-K Risk Factors or MD&A year-over-year. Open DIFF AAPL, pick filing years in settings.",
      keywords: [
        "10-k",
        "diff",
        "risk",
        "mda",
        "md&a",
        "annual",
        "filing",
        "forensic",
        "changes",
      ],
      category: "Data",
      shortcut: {
        prefix: "DIFF",
        argPlaceholder: "ticker",
        argKind: "ticker",
        argOptional: true,
      },
      createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
        return createFilingDiffInstance(options);
      },
    },
  ],

  setup() {
    disposeConnection = registerConnectionSource({
      id: FILING_DIFF_CONNECTION_ID,
      name: "Filing Diff (SEC EDGAR)",
      kind: "api",
      pluginId: FILING_DIFF_PLUGIN_ID,
      authRequired: false,
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },
};

export default filingDiffPlugin;
