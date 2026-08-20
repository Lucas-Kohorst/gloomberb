import { useCallback, useEffect, useMemo, useState } from "react";
import { ListView, type ListViewItem } from "../../../components/ui";
import { t } from "../../../i18n";
import {
  syncConfigActiveLayoutState,
  useAppDispatch,
  useAppStateRef,
  useOptionalPaneInstanceId,
} from "../../../state/app/context";
import { scheduleConfigSave } from "../../../state/config-save-scheduler";
import type { PaneProps } from "../../../types/plugin";
import { Box } from "../../../ui";
import { usePluginAppActions } from "../../runtime";
import { chatController, type ChatController } from "./controller";
import { applyUnreadInboxItemToConfig } from "./pane-state";
import {
  formatUnreadInboxRowLabel,
  type UnreadInboxItem,
} from "./unread-inbox";

interface UnreadInboxPaneProps extends PaneProps {
  controller?: Pick<ChatController, "listUnreadInbox" | "subscribe">;
}

export function UnreadInboxPane({
  width,
  height,
  controller = chatController,
}: UnreadInboxPaneProps) {
  const dispatch = useAppDispatch();
  const stateRef = useAppStateRef();
  const inboxInstanceId = useOptionalPaneInstanceId();
  const { createPaneFromTemplate, focusPane } = usePluginAppActions();
  const [items, setItems] = useState<UnreadInboxItem[]>(() => controller.listUnreadInbox());
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    const unsubscribe = controller.subscribe(() => {
      setItems(controller.listUnreadInbox());
    });
    return unsubscribe;
  }, [controller]);

  const openItem = useCallback((item: UnreadInboxItem) => {
    const currentState = stateRef.current;
    const { config, chatInstanceId } = applyUnreadInboxItemToConfig(
      currentState.config,
      item,
      inboxInstanceId,
    );
    const syncedConfig = syncConfigActiveLayoutState(
      config,
      currentState.paneState,
      currentState.focusedPaneId,
      currentState.activePanel,
    );
    dispatch({ type: "SET_CONFIG", config: syncedConfig });
    scheduleConfigSave(syncedConfig);
    if (chatInstanceId) {
      focusPane(chatInstanceId);
      return;
    }
    createPaneFromTemplate("new-chat-pane", {
      arg: item.channelId,
      ...(item.messageId ? { values: { messageId: item.messageId } } : {}),
    });
  }, [createPaneFromTemplate, dispatch, focusPane, inboxInstanceId, stateRef]);

  const listItems = useMemo<ListViewItem[]>(() => items.map((item) => ({
    id: item.id,
    label: formatUnreadInboxRowLabel(item),
  })), [items]);

  const safeSelectedIndex = listItems.length === 0
    ? 0
    : Math.min(selectedIndex, listItems.length - 1);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <ListView
        items={listItems}
        selectedIndex={safeSelectedIndex}
        onSelect={setSelectedIndex}
        onActivate={(listItem) => {
          const item = items.find((entry) => entry.id === listItem.id);
          if (item) openItem(item);
        }}
        selectOnHover
        scrollable
        flexGrow={1}
        height={height}
        emptyMessage={t("No unread messages")}
        surface="plain"
      />
    </Box>
  );
}
