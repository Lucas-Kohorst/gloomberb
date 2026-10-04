import type { GloomPlugin, PaneTemplateCreateOptions } from "../../../types/plugin";
import { CommentLettersPane } from "./pane";
import { COMMENT_LETTERS_PANE_ID, COMMENT_LETTERS_PLUGIN_ID } from "./types";

const createCommentLettersPaneInstance = (options?: PaneTemplateCreateOptions) => {
  const query = (options?.arg ?? options?.symbol ?? options?.values?.query ?? "").trim();
  const encoded = encodeURIComponent(query).replace(/%/g, "~");
  return {
    instanceId: query ? `comment-letters:${encoded}` : "comment-letters:latest",
    title: query ? `Comment Letters ${query}` : "Comment Letters",
    placement: "floating" as const,
    binding: { kind: "none" as const },
    settings: { query },
  };
};

export const commentLettersPlugin: GloomPlugin = {
  id: COMMENT_LETTERS_PLUGIN_ID,
  name: "SEC Comment Letters",
  version: "1.0.0",
  description:
    "SEC comment letters (CORRESP and UPLOAD). Search by company or topic.",
  toggleable: true,

  // One JSON endpoint over HTTPS, so every renderer. EDGAR sends no CORS
  // headers, which is why the host is declared: the web app proxies it.
  targets: ["cli", "tui", "desktop", "web"],
  hosts: ["efts.sec.gov"],

  panes: [
    {
      id: COMMENT_LETTERS_PANE_ID,
      name: "Comment Letters",
      icon: "L",
      component: CommentLettersPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
      tableExport: true,
    },
  ],

  paneTemplates: [
    {
      id: "comment-letters-pane",
      paneId: COMMENT_LETTERS_PANE_ID,
      label: "SEC Comment Letters",
      description:
        "SEC comment letters, forms CORRESP and UPLOAD, by company or topic.",
      keywords: [
        "comment",
        "letters",
        "corresp",
        "upload",
        "sec",
        "edgar",
        "correspondence",
        "company",
        "topic",
      ],
      shortcut: {
        prefix: "CLTR",
        argPlaceholder: "company or topic",
        argKind: "text",
        argOptional: true,
      },
      createInstance: (_context, options) => createCommentLettersPaneInstance(options),
    },
  ],
};
