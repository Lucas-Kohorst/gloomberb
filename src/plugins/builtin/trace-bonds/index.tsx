import type { GloomPlugin, PaneTemplateCreateOptions } from "../../../types/plugin";
import { traceBondsHeadless } from "./headless";
import { TRACE_BONDS_PANE_ID } from "./model";
import { TraceBondsPane } from "./pane";

function createTraceBondsInstance(options?: PaneTemplateCreateOptions) {
  const issuer = (options?.arg ?? "").trim();
  const encoded = encodeURIComponent(issuer).replace(/%/g, "~");
  return {
    instanceId: issuer ? `trace-bonds:${encoded}` : "trace-bonds",
    placement: "floating" as const,
    binding: { kind: "none" as const },
    ...(issuer ? { params: { issuer } } : {}),
  };
}

export const traceBondsPlugin: GloomPlugin = {
  id: "trace-bonds",
  name: "Corporate Bond Tape",
  version: "1.0.0",
  description: "Latest corporate and agency bond sales: issuer, coupon, price, yield, and grade.",
  toggleable: true,

  targets: ["cli", "tui", "desktop", "web"],
  hosts: ["services-dynarep.ddwa.finra.org"],

  panes: [
    {
      id: TRACE_BONDS_PANE_ID,
      name: "Corporate Bond Tape",
      icon: "B",
      component: TraceBondsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 120, height: 28 },
      tableExport: true,
      headless: traceBondsHeadless,
    },
  ],

  paneTemplates: [
    {
      id: "trace-bonds-pane",
      paneId: TRACE_BONDS_PANE_ID,
      label: "Corporate Bond Tape",
      description: "Latest corporate and agency bond sales: issuer, coupon, price, yield, and grade.",
      keywords: [
        "bond",
        "bonds",
        "corporate",
        "agency",
        "coupon",
        "yield",
        "issuer",
        "credit",
        "fixed income",
        "trace",
      ],
      shortcut: {
        prefix: "TRACE",
        argKind: "text",
        argOptional: true,
        argPlaceholder: "issuer",
      },
      headless: traceBondsHeadless,
      createInstance: (_context, options) => createTraceBondsInstance(options),
    },
  ],
};
