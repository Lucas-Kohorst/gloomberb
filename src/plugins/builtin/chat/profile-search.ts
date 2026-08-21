import type { CommandResultDef, GloomPluginContext } from "../../../types/plugin";
import type { ChatChannel, ChatMessage, ChatUserSummary } from "../../../api-client";
import { t } from "../../../i18n";
import { chatController } from "./controller";
import { requestOpenChatProfile } from "./profile-request";

function rememberUser(map: Map<string, ChatUserSummary>, user: ChatUserSummary | null | undefined): void {
  if (!user?.id) return;
  const existing = map.get(user.id);
  map.set(user.id, existing ? { ...existing, ...user } : user);
}

export function collectKnownChatUsers(
  channels: ChatChannel[],
  messages: ChatMessage[],
): ChatUserSummary[] {
  const map = new Map<string, ChatUserSummary>();
  for (const message of messages) rememberUser(map, message.user);
  for (const channel of channels) {
    rememberUser(map, channel.dmUser);
    for (const member of channel.members ?? []) rememberUser(map, member);
  }
  return [...map.values()].sort((left, right) => {
    const leftName = (left.username ?? left.displayName).toLowerCase();
    const rightName = (right.username ?? right.displayName).toLowerCase();
    return leftName.localeCompare(rightName);
  });
}

export function listKnownChatUsersFromController(
  controller: {
    getChannels: () => ChatChannel[];
    getSnapshot: (channelId?: string) => { messages: ChatMessage[] };
  } = chatController,
): ChatUserSummary[] {
  const channels = controller.getChannels();
  const messages = channels.flatMap((channel) => controller.getSnapshot(channel.id).messages);
  return collectKnownChatUsers(channels, messages);
}

function matchesProfileQuery(user: ChatUserSummary, query: string): boolean {
  if (!query) return true;
  const haystack = [
    user.username,
    user.displayName,
    user.company,
    user.title,
    user.bio,
    user.xAccount,
  ].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(query);
}

export function openChatProfileFromCommand(
  ctx: Pick<GloomPluginContext, "createPaneFromTemplate">,
  user: ChatUserSummary,
): void {
  requestOpenChatProfile(user);
  const username = user.username?.trim().toLowerCase();
  const dm = chatController.getChannels().find((channel) => (
    channel.kind === "direct"
    && (
      channel.dmUser?.id === user.id
      || (username && channel.dmUser?.username?.trim().toLowerCase() === username)
    )
  ));
  ctx.createPaneFromTemplate("new-chat-pane", dm ? { arg: dm.id } : undefined);
}

function isListedPublicChatProfile(user: ChatUserSummary): boolean {
  return user.profilePublic === true;
}

export function buildWhoCommandResults(ctx: GloomPluginContext, arg: string): CommandResultDef[] {
  const trimmed = arg.trim();
  const query = trimmed.replace(/^@+/, "").toLowerCase();
  const users = listKnownChatUsersFromController(chatController)
    .filter((user) => isListedPublicChatProfile(user) && matchesProfileQuery(user, query));

  if (users.length > 0) {
    return users.map((user) => {
      const username = user.username?.trim();
      const label = username ? `@${username}` : user.displayName;
      const detail = [user.displayName !== label ? user.displayName : null, user.company, user.title]
        .filter(Boolean)
        .join(" / ") || t("Open public profile");
      return {
        id: `who:${user.id}`,
        label,
        detail,
        category: t("People"),
        right: "WHO",
        keywords: [user.username ?? "", user.displayName, user.company ?? ""],
        execute: () => openChatProfileFromCommand(ctx, user),
      };
    });
  }

  return [{
    id: query ? `who:none:${query}` : "who:empty",
    label: query ? t("No public profile matched") : t("No public chat profiles yet"),
    detail: t("WHO only lists people with a public profile"),
    category: t("People"),
    right: "WHO",
    disabled: true,
    execute: () => {},
  }];
}
