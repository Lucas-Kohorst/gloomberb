import type { GloomPlugin, PaneTemplateCreateOptions } from "../../../types/plugin";
import { edgarFilingsHeadless } from "./headless";
import { EdgarFilingsPane } from "./pane";
import { EDGAR_FILINGS_PANE_ID, EDGAR_FILINGS_PLUGIN_ID } from "./types";

const createEdgarFilingsInstance = (options?: PaneTemplateCreateOptions) => {
  const form = (options?.arg ?? "").trim().toUpperCase();
  const encoded = encodeURIComponent(form).replace(/%/g, "~");
  return {
    instanceId: form ? `edgar-filings:${encoded}` : "edgar-filings:latest",
    title: form ? `Filings ${form}` : "Latest Filings",
    placement: "floating" as const,
    binding: { kind: "none" as const },
    settings: { form },
  };
};

export const edgarFilingsPlugin: GloomPlugin = {
  id: EDGAR_FILINGS_PLUGIN_ID,
  name: "Latest Filings",
  version: "1.0.0",
  description:
    "Newest SEC filings as they are accepted, every form. A filing with several filers is listed once for each of them.",
  toggleable: true,

  // The current-filings feed is one Atom document. It sends no CORS headers,
  // so the web app proxies the host.
  targets: ["cli", "tui", "desktop", "web"],
  hosts: ["www.sec.gov"],

  panes: [
    {
      id: EDGAR_FILINGS_PANE_ID,
      name: "Latest Filings",
      icon: "F",
      component: EdgarFilingsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 110, height: 30 },
      tableExport: true,
      headless: edgarFilingsHeadless,
    },
  ],

  paneTemplates: [
    {
      id: "edgar-filings-pane",
      paneId: EDGAR_FILINGS_PANE_ID,
      label: "Latest Filings",
      description:
        "Every SEC filing as it is accepted, newest first: 8-Ks, 10-Ks, Form 4s, registration statements, and the rest.",
      keywords: [
        "edgar",
        "filings",
        "filing",
        "latest",
        "feed",
        "8-k",
        "10-k",
        "10-q",
        "form 4",
        "sec",
        "n-port",
        "stream",
      ],
      shortcut: {
        prefix: "EDG",
        argPlaceholder: "form",
        argKind: "text",
        argOptional: true,
      },
      headless: edgarFilingsHeadless,
      createInstance: (_context, options) => createEdgarFilingsInstance(options),
    },
  ],
};
