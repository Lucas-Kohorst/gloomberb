import { useEffect, useState, useSyncExternalStore } from "react";
import { colors } from "../../../../theme/colors";
import { Box, Text, TextAttributes } from "../../../../ui";
import { usePluginAppActions } from "../../../runtime";
import { chatController } from "../../chat/controller";
import { countTeamUpdates, teamAccentHex, teamIdFromChannelId } from "./model";
import { requestNotificationCenterFilter } from "../../notification-center/filter";
import { openTeamPane } from "./pane-request";
import { teamStore } from "./store";

/**
 * One chip per team in the status bar, in the team's accent, with the unread
 * chat count and the number of pending cards (invites, layout updates). Hidden
 * teams under FOCUS keep their chip so the lens is visible, dimmed. A chip
 * with pending cards opens the notification center on the team filter.
 * Otherwise it opens the team pane.
 */
/** `ADJ [1]`, one space before the count. No count means just the short name. */
export function teamStatusChipText(shortName: string, count: number): string {
  return count > 0 ? `${shortName} [${count}]` : shortName;
}

export function TeamStatusWidget() {
  const { createPaneFromTemplate } = usePluginAppActions();
  const snapshot = useSyncExternalStore(
    (onChange) => teamStore.subscribe(onChange),
    () => teamStore.getSnapshot(),
  );
  // The chat controller builds a fresh snapshot per call, so it cannot back
  // useSyncExternalStore; subscribe and keep only what the chips show.
  const [unreadByChannel, setUnreadByChannel] = useState<ReadonlyMap<string, number>>(() => new Map());
  useEffect(() => chatController.subscribe((chat) => {
    setUnreadByChannel((previous) => {
      const next = new Map<string, number>();
      for (const state of chat.channelStates) {
        if (state.channelId.startsWith("team:") && state.unreadCount > 0) next.set(state.channelId, state.unreadCount);
      }
      if (next.size === previous.size && [...next].every(([id, count]) => previous.get(id) === count)) return previous;
      return next;
    });
  }), []);
  if (snapshot.teams.length === 0) return null;

  const updates = countTeamUpdates(snapshot.notifications);

  return (
    <Box flexDirection="row" gap={1}>
      {snapshot.teams.map((team) => {
        const accent = teamAccentHex(team.accentColor);
        let unread = 0;
        for (const [channelId, count] of unreadByChannel) {
          if (teamIdFromChannelId(channelId) === team.id) unread += count;
        }
        const cards = updates.get(team.id) ?? 0;
        const muted =
          snapshot.focus === "personal" ||
          (typeof snapshot.focus === "object" && snapshot.focus.teamId !== team.id);
        const count = unread + cards;
        const fg = muted ? colors.textMuted : accent;
        return (
          <Box
            key={team.id}
            flexDirection="row"
            onMouseDown={(event: { preventDefault?: () => void; stopPropagation?: () => void }) => {
              event.preventDefault?.();
              event.stopPropagation?.();
              if (cards > 0) {
                requestNotificationCenterFilter("team");
                createPaneFromTemplate("notification-center-pane");
                return;
              }
              openTeamPane(createPaneFromTemplate, { teamId: team.id });
            }}
            data-gloom-role="status-team"
            data-gloom-interactive="true"
            style={{ cursor: "pointer" }}
          >
            <Text fg={fg} attributes={count > 0 && !muted ? TextAttributes.BOLD : 0}>
              {teamStatusChipText(team.shortName, count)}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
