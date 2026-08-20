import type { ComponentType, ReactNode } from "react";
import type { GloomPlugin, PaneProps } from "../../../types/plugin";
import { apiClient } from "../../../api-client";
import { createGloomberbCloudCapabilities, createGloomberbCloudProvider } from "../../../sources/gloomberb-cloud";
import { AccountManagementPane } from "../account-management/pane";
import { chatController } from "../chat/controller";
import {
  buildDmCommandResults,
  formatChatPaneTitle,
  getPreferredChatOpenChannelId,
  normalizeShortcutChannelId,
  openDmTargetFromCommand,
  parseConversationCreateArg,
} from "../chat/channels";
import { UnreadInboxPane } from "../chat/unread-inbox-pane";
import { UNREAD_INBOX_PANE_ID, UNREAD_INBOX_TEMPLATE_ID } from "../chat/unread-inbox";
import { registerTwitterFeedFeature } from "../cloud-tweets/registration";
import { composeBuiltinPlugin, type PluginModule } from "../plugin-module";
import { registerCloudAuthCommands } from "./auth-commands";
import { registerCloudUpgradeCommand } from "./upgrade-command";
import { CloudUpgradeStatusWidget } from "./upgrade-status-widget";
import { registerConnectionSource, withConnectionRequest } from "../connections/register";
import type { SyncTransport } from "../../../sync/types";

interface GloomberbCloudPluginComponents {
  ChatPane: (props: PaneProps) => ReactNode;
  ChatStatusWidget: ComponentType;
}

function createCloudDataModule(): PluginModule {
  let disposeConfigConnection: (() => void) | null = null;
  return {
    capabilities: createGloomberbCloudCapabilities(createGloomberbCloudProvider()),
    setup(ctx) {
      ctx.registerSyncTransport(createGloomberbCloudSyncTransport());
      disposeConfigConnection = registerConnectionSource({
        id: "hosted-config",
        name: "Hosted Config Sync",
        kind: "api",
        pluginId: "gloomberb-cloud",
        priority: 100,
        authRequired: true,
      });
    },
    dispose() {
      disposeConfigConnection?.();
      apiClient.dispose();
    },
  };
}

export function createGloomberbCloudSyncTransport(
  isAvailable: () => boolean = () => apiClient.isVerified(),
): SyncTransport {
  return {
    id: "gloomberb-cloud",
    isAvailable,
    pullSnapshot: () => withConnectionRequest("gloom-cloud", "pullSnapshot", () => apiClient.getSyncSnapshot()),
    pushSnapshot: (snapshot, options) => withConnectionRequest(
      "gloom-cloud",
      "pushSnapshot",
      () => apiClient.putSyncSnapshot(snapshot, options),
    ),
  };
}

function createChatModule(
  ChatPane: GloomberbCloudPluginComponents["ChatPane"],
  ChatStatusWidget: GloomberbCloudPluginComponents["ChatStatusWidget"],
): PluginModule {
  return {
    panes: [{
      id: "chat",
      name: "Chat",
      icon: "C",
      component: ChatPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 80, height: 30 },
    }, {
      id: UNREAD_INBOX_PANE_ID,
      name: "Unread",
      icon: "@",
      component: UnreadInboxPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 56, height: 16 },
    }],
    paneTemplates: [{
      id: "new-chat-pane",
      paneId: "chat",
      label: "New Chat Pane",
      description: "Open the floating chat window",
      keywords: ["new", "chat", "pane", "message"],
      shortcut: { prefix: "CHAT", argPlaceholder: "channel", argKind: "text" },
      singleton: true,
      createInstance: async (context, options) => {
        const channelId = options?.arg
          ? await chatController.resolveRequiredChannelId(normalizeShortcutChannelId(options.arg))
          : await chatController.resolvePreferredChannelId(
            getPreferredChatOpenChannelId(context.config, chatController.getSnapshot()),
          );
        const channel = chatController.getChannels().find((entry) => entry.id === channelId);
        const targetMessageId = options?.values?.messageId?.trim() || null;
        return {
          placement: "floating",
          title: formatChatPaneTitle(channel, channelId),
          settings: {
            channelId,
            ...(targetMessageId ? { targetMessageId } : {}),
          },
        };
      },
    }, {
      id: UNREAD_INBOX_TEMPLATE_ID,
      paneId: UNREAD_INBOX_PANE_ID,
      label: "Unread Messages",
      description: "Open unread chat messages and jump to the channel",
      keywords: ["unread", "inbox", "mentions", "messages", "chat"],
      shortcut: { prefix: "UNREAD" },
      singleton: true,
      createInstance: () => ({ placement: "floating", title: "Unread" }),
    }],
    slots: {
      "status:widget": () => <ChatStatusWidget />,
    },
    setup(ctx) {
      chatController.attachPersistence(ctx.persistence, ctx.resume);
      chatController.setNotifier(ctx.notify);
      ctx.registerCommand({
        id: "direct-message",
        label: "DM",
        description: "Open an existing DM or start a direct/group chat",
        keywords: ["dm", "direct", "message", "group", "chat"],
        category: "navigation",
        shortcut: "DM",
        shortcutArg: {
          placeholder: "@username [@username...] [name]",
          kind: "text",
          parse: (arg) => ({ participants: arg.trim() }),
        },
        buildResults: (arg) => buildDmCommandResults(ctx, arg),
        execute: async (values) => {
          const participants = values?.participants ?? values?.shortcut ?? "";
          const created = parseConversationCreateArg(participants);
          if (participants.trim() && !created) {
            throw new Error("Use @username, or multiple usernames and an optional name for a group.");
          }
          await openDmTargetFromCommand(ctx, created?.usernames ?? [], created?.name);
        },
      });
    },
    dispose() {
      chatController.dispose();
    },
  };
}

const accountModule: PluginModule = {
  panes: [{
    id: "account-management",
    name: "ACM",
    icon: "A",
    component: AccountManagementPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 72, height: 36 },
  }],
  paneTemplates: [{
    id: "account-management-pane",
    paneId: "account-management",
    label: "Account Management",
    description: "Manage your Gloom Cloud profile, AI providers, password, and public portfolio sharing settings",
    keywords: ["account", "profile", "cloud", "acm", "password", "settings", "ai", "provider", "ollama", "openrouter", "anthropic", "openai"],
    shortcut: { prefix: "ACM" },
    createInstance: () => ({ placement: "floating" }),
  }],
  slots: {
    "status:widget": () => <CloudUpgradeStatusWidget />,
  },
  setup: (ctx) => {
    registerCloudAuthCommands(ctx);
    registerCloudUpgradeCommand(ctx);
  },
};

const twitterModule: PluginModule = {
  setup: registerTwitterFeedFeature,
};

export function createGloomberbCloudPlugin({
  ChatPane,
  ChatStatusWidget,
}: GloomberbCloudPluginComponents): GloomPlugin {
  return composeBuiltinPlugin({
    id: "gloomberb-cloud",
    name: "Gloom Cloud",
    version: "1.0.0",
    description: "Gloom Cloud auth, chat, sync, and Twitter feeds. Chat requires signup.",
    toggleable: true,
    order: 10,
    modules: [
      createCloudDataModule(),
      createChatModule(ChatPane, ChatStatusWidget),
      accountModule,
      twitterModule,
    ],
  });
}
