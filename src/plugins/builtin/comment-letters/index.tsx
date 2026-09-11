import type {
  GloomPlugin,
  PaneTemplateContext,
  PaneTemplateCreateOptions,
} from "../../../types/plugin";
import { registerConnectionSource } from "../connections/register";
import { CommentLettersPane } from "./pane";
import {
  COMMENT_LETTERS_CONNECTION_ID,
  COMMENT_LETTERS_PLUGIN_ID,
} from "./types";

function queryFromTemplateOptions(options?: PaneTemplateCreateOptions): string {
  return (options?.arg ?? options?.values?.query ?? "").trim();
}

function createCommentLettersPaneInstance(
  options?: PaneTemplateCreateOptions,
) {
  const query = queryFromTemplateOptions(options);
  const encoded = encodeURIComponent(query).replace(/%/g, "~");
  return {
    instanceId: query ? `comment-letters:${encoded}` : "comment-letters:latest",
    title: query ? `Comment Letters ${query}` : "Comment Letters",
    placement: "floating" as const,
    binding: { kind: "none" as const },
    settings: { query },
  };
}

let disposeConnection: (() => void) | null = null;

export const commentLettersPlugin: GloomPlugin = {
  id: COMMENT_LETTERS_PLUGIN_ID,
  name: "SEC Comment Letters",
  version: "1.0.0",
  description:
    "SEC comment letters (CORRESP/UPLOAD) with keyword severity triage. Search by company to see recent informal SEC correspondence.",
  toggleable: true,

  panes: [
    {
      id: "comment-letters",
      name: "Comment Letters",
      icon: "L",
      component: CommentLettersPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
    },
  ],

  paneTemplates: [
    {
      id: "comment-letters-pane",
      paneId: "comment-letters",
      label: "SEC Comment Letters",
      description:
        "SEC comment letters (CORRESP/UPLOAD) with keyword severity triage. Search by company to see recent informal SEC correspondence.",
      keywords: [
        "comment",
        "letters",
        "corresp",
        "upload",
        "sec",
        "edgar",
        "correspondence",
        "enforcement",
        "severity",
      ],
      category: "Data",
      shortcut: {
        prefix: "CLTR",
        argPlaceholder: "company or topic",
        argKind: "text",
        argOptional: true,
      },
      createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
        return createCommentLettersPaneInstance(options);
      },
    },
  ],

  setup() {
    disposeConnection = registerConnectionSource({
      id: COMMENT_LETTERS_CONNECTION_ID,
      name: "SEC Comment Letters",
      kind: "api",
      pluginId: COMMENT_LETTERS_PLUGIN_ID,
      authRequired: false,
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },
};

export default commentLettersPlugin;
