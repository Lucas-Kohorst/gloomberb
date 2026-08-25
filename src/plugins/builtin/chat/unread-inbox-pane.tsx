import { useCallback, useEffect, useMemo, useState } from "react";
import { ListView, type ListViewItem } from "../../../components/ui";
import { t } from "../../../i18n";
import { useShortcut } from "../../../react/input";
import {
  syncConfigActiveLayoutState,
  useAppDispatch,
  useAppStateRef,
  useOptionalPaneInstanceId,
} from "../../../state/app/context";
import { scheduleConfigSave } from "../../../state/config-save-scheduler";
import type { PaneProps } from "../../../types/plugin";
import { Box } from "../../../ui";
import { isPlainKey } from "../../../utils/keyboard";
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
  focused = false,
  controller = chatController,
}: UnreadInboxPaneProps) {
  const dispatch = useAppDispatch();
  const stateRef = useAppStateRef();
  const inboxInstanceId = useOptionalPaneInstanceId();
  const { createPaneFromTemplate } = usePluginAppActions();
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
      // FOCUS_PANE reads the layout SET_CONFIG just wrote. Plugin focusPane
      // persistLayout can replay the pre-click layout and reopen Unread.
      dispatch({ type: "FOCUS_PANE", paneId: chatInstanceId });
      return;
    }
    createPaneFromTemplate("new-chat-pane", {
      arg: item.channelId,
      ...(item.messageId ? { values: { messageId: item.messageId } } : {}),
    });
  }, [createPaneFromTemplate, dispatch, inboxInstanceId, stateRef]);

  const listItems = useMemo<ListViewItem[]>(() => items.map((item) => ({
    id: item.id,
    label: formatUnreadInboxRowLabel(item),
  })), [items]);

  const safeSelectedIndex = listItems.length === 0
    ? 0
    : Math.min(selectedIndex, listItems.length - 1);

  const activateSelected = useCallback(() => {
    const item = items[safeSelectedIndex];
    if (item) openItem(item);
  }, [items, openItem, safeSelectedIndex]);

  useShortcut((event) => {
    if (!focused || event.defaultPrevented || event.propagationStopped) return;
    if (items.length === 0) return;
    if (isPlainKey(event, "up", "k")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      setSelectedIndex((current) => Math.max(0, Math.min(current, items.length - 1) - 1));
      return;
    }
    if (isPlainKey(event, "down", "j")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      setSelectedIndex((current) => Math.min(items.length - 1, current + 1));
      return;
    }
    if (event.name === "enter" || event.name === "return") {
      event.preventDefault?.();
      event.stopPropagation?.();
      activateSelected();
    }
  }, { enabled: focused });

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
