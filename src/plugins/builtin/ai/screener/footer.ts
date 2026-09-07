import { usePaneFooter } from "../../../../components";
import { t } from "../../../../i18n";
import { useAppLanguage } from "../../../../i18n/react";
import type { AiScreenerTab, RunState, ScreenerEditorState } from "./model";

interface UseAiScreenerFooterOptions {
  activeTab: AiScreenerTab | null;
  editorState: ScreenerEditorState | null;
  isRunningActiveTab: boolean;
  runState: RunState | null;
  onAddTab: () => void;
  onCancelRun: () => void;
  onCloseEditor: () => void;
  onEdit: () => void;
  onRefresh: () => void;
  onSaveEditor: () => void;
}

export function useAiScreenerFooter({
  activeTab,
  editorState,
  isRunningActiveTab,
  runState,
  onAddTab,
  onCancelRun,
  onCloseEditor,
  onEdit,
  onRefresh,
  onSaveEditor,
}: UseAiScreenerFooterOptions) {
  const language = useAppLanguage();
  usePaneFooter("ai-screener", () => ({
    info: activeTab?.lastError
      ? [{
          id: "error",
          parts: [{ text: activeTab.lastError, tone: "warning" as const }],
        }]
      : [],
    // Left-side info is reserved for source/updated/error segments; run state
    // and warnings ride on the trailing side so they stay visible.
    trailingInfo: isRunningActiveTab && runState
      ? [{
          id: "running",
          parts: [{
            text: t("Refreshing…"),
            tone: "muted" as const,
          }],
        }]
      : activeTab?.lastWarning && !activeTab?.lastError
        ? [{
            id: "warning",
            parts: [{ text: activeTab.lastWarning, tone: "warning" as const }],
          }]
        : [],
    hints: editorState
      ? [
          {
            id: "save",
            key: "Ctrl+S",
            label: t("save"),
            onPress: onSaveEditor,
          },
          {
            id: "cancel",
            key: "Esc",
            label: t("cancel"),
            onPress: onCloseEditor,
          },
        ]
      : isRunningActiveTab
        ? []
        : [
            {
              id: "new",
              key: "t",
              label: t("new"),
              onPress: onAddTab,
            },
            {
              id: "edit",
              key: "e",
              label: t("dit"),
              onPress: onEdit,
              disabled: !activeTab,
            },
          ],
  }), [
    activeTab,
    editorState,
    isRunningActiveTab,
    language,
    onAddTab,
    onCancelRun,
    onCloseEditor,
    onEdit,
    onRefresh,
    onSaveEditor,
    runState,
  ]);
}
