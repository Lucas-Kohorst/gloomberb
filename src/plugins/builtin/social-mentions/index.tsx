import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import { SOCIAL_MENTIONS_CONNECTION_ID, socialMentionPostsCache, socialMentionsCache } from "./client";
import { socialMentionsHeadless } from "./headless";
import { SocialMentionsPane } from "./pane";

const socialMentionsSettings = [{
  key: "socialRange",
  label: "History",
  type: "select" as const,
  options: [
    { value: "1y", label: "1 year" },
    { value: "5y", label: "5 years" },
    { value: "max", label: "Since 2012" },
  ],
}];

let disposeConnection: (() => void) | null = null;

export const socialMentionsModule: PluginModule = {
  panes: [{
    id: "social-mentions",
    name: "Social Mentions",
    icon: "B",
    component: SocialMentionsPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 96, height: 30 },
    tableExport: true,
    headless: socialMentionsHeadless,
    settings: { title: "Social Mentions", fields: socialMentionsSettings },
  }],
  paneTemplates: [{
    ...createTickerSurfacePaneTemplate({
      id: "social-mentions-pane",
      paneId: "social-mentions",
      label: "Social Mentions",
      description: "Daily posts on X naming the ticker's cashtag, Wikipedia article views, and the day's top posts.",
      shortcut: "BUZZ",
      keywords: ["social", "mentions", "x", "twitter", "buzz", "sentiment", "stance", "cashtag", "wikipedia"],
      publicShare: true,
    }),
    headless: socialMentionsHeadless,
  }],
  setup(ctx) {
    socialMentionsCache.attach(ctx.persistence);
    socialMentionPostsCache.attach(ctx.persistence);
    disposeConnection?.();
    disposeConnection = registerConnectionSource({
      id: SOCIAL_MENTIONS_CONNECTION_ID,
      name: "Gloom Cloud Social Mentions",
      kind: "api",
      pluginId: "ticker-research",
      authRequired: false,
    });
  },
  dispose() {
    disposeConnection?.();
    disposeConnection = null;
    socialMentionsCache.reset();
    socialMentionPostsCache.reset();
  },
};
