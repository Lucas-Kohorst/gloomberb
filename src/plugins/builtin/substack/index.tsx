import type { GloomPlugin } from "../../../types/plugin";
import {
  attachSubstackPersistence,
  resetSubstackPersistence,
  subscribeSubstackAuth,
} from "./api/store";
import { getSharedNewsService } from "../../../news/hooks";
import {
  ARTICLE_READER_FLOATING_SIZE,
  SUBSTACK_ARTICLE_READER_PANE_ID,
  SUBSTACK_ARTICLE_READER_TEMPLATE_ID,
  articleReaderInstanceId,
} from "../shared/article-pop-out";
import {
  SUBSTACK_PANE_ID,
  SUBSTACK_PLUGIN_ID,
} from "./types";
import { SubstackArticleReaderPane } from "./article-reader";
import { SubstackPane } from "./pane";
import { createSubstackNewsCapability } from "./news-capability";
import { registerConnectionSource } from "../connections/register";
import { buildSubstackPaneSettingsDef } from "./settings";

let disposeSubstackConnection: (() => void) | null = null;
let disposeSubstackAuthWatch: (() => void) | null = null;

export const substackPlugin: GloomPlugin = {
  id: SUBSTACK_PLUGIN_ID,
  name: "Substack",
  version: "1.0.0",
  description: "Authenticated Substack reader feed and subscriptions",
  toggleable: true,

  setup(ctx) {
    attachSubstackPersistence(ctx.persistence);
    ctx.registerCapability?.(createSubstackNewsCapability());
    // Logging in/out flips this source between empty and populated; re-run the
    // watched news queries so the firehose merges Substack without a reload.
    disposeSubstackAuthWatch = subscribeSubstackAuth(() => {
      void getSharedNewsService()?.refreshWatchedQueries();
    });
    disposeSubstackConnection = registerConnectionSource({
      id: "substack",
      name: "Substack",
      kind: "news",
      pluginId: SUBSTACK_PLUGIN_ID,
      priority: 600,
      authRequired: true,
    });
  },

  dispose() {
    resetSubstackPersistence();
    disposeSubstackConnection?.();
    disposeSubstackConnection = null;
    disposeSubstackAuthWatch?.();
    disposeSubstackAuthWatch = null;
  },

  panes: [
    {
      id: SUBSTACK_PANE_ID,
      name: "Substack",
      icon: "S",
      component: SubstackPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 104, height: 32 },
      settings: (context) => buildSubstackPaneSettingsDef(context.settings),
    },
    {
      id: SUBSTACK_ARTICLE_READER_PANE_ID,
      name: "Article",
      icon: "A",
      component: SubstackArticleReaderPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: ARTICLE_READER_FLOATING_SIZE,
    },
  ],

  paneTemplates: [
    {
      id: "substack-pane",
      paneId: SUBSTACK_PANE_ID,
      label: "Substack",
      description: "Open the authenticated Substack reader feed.",
      keywords: ["substack", "newsletter", "feed", "reader", "subscription"],
      shortcut: { prefix: "SUB" },
    },
    {
      id: SUBSTACK_ARTICLE_READER_TEMPLATE_ID,
      paneId: SUBSTACK_ARTICLE_READER_PANE_ID,
      label: "Substack Article",
      description: "Read a popped-out Substack article.",
      keywords: ["substack", "article", "reader"],
      canCreate: (_context, options) => !!options?.arg?.trim(),
      createInstance: (_context, options) => {
        const articleId = options?.arg?.trim() ?? "";
        if (!articleId) return null;
        return {
          instanceId: articleReaderInstanceId(SUBSTACK_ARTICLE_READER_PANE_ID, articleId),
          title: options?.values?.title?.trim() || "Article",
          placement: "floating",
          settings: {
            articleId,
            title: options?.values?.title ?? "",
            url: options?.values?.url ?? "",
          },
        };
      },
    },
  ],
};
