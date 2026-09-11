import { useMemo, useRef } from "react";
import { usePaneFooter, type PaneFooterSegment, type PaneHint } from "../../../components";
import { isBrokerErrorMessage } from "./table";

interface BrokerManagerFooterActions {
  connectSelected: () => Promise<void>;
  openAddBroker: () => void;
  openProfileAction: () => void;
  removeSelected: () => Promise<void>;
  saveEdit: () => Promise<void>;
  startEdit: () => void;
  syncSelected: () => Promise<void>;
}

export function useBrokerManagerFooter({
  actions,
  canOpenSelectedAction,
  canRemoveSelected,
  canUseSelectedBroker,
  editing,
  busy,
  message,
  summary,
}: {
  actions: BrokerManagerFooterActions;
  canOpenSelectedAction: boolean;
  canRemoveSelected: boolean;
  canUseSelectedBroker: boolean;
  editing: boolean;
  busy: string | null;
  message: string | null;
  summary: string | null;
}) {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const footerHints = useMemo<PaneHint[]>(() => {
    // Enter to save and Esc to cancel are app-wide form conventions, and the edit
    // form already renders its own Save and Cancel buttons, so the footer stays empty.
    if (editing) return [];

    const hints: PaneHint[] = [
      { id: "add", key: "a", label: "dd", onPress: () => actionsRef.current.openAddBroker() },
    ];
    if (canUseSelectedBroker) {
      hints.push(
        { id: "edit", key: "e", label: "dit", onPress: () => actionsRef.current.startEdit() },
        { id: "connect", key: "c", label: "onnect", onPress: () => actionsRef.current.connectSelected().catch(() => {}) },
        { id: "sync", key: "s", label: "ync", onPress: () => actionsRef.current.syncSelected().catch(() => {}) },
      );
    }
    if (canOpenSelectedAction) {
      hints.push({ id: "open", key: "o", label: "pen", onPress: () => actionsRef.current.openProfileAction() });
    }
    if (canRemoveSelected) {
      hints.push({ id: "disconnect", key: "d", label: "isconnect", onPress: () => actionsRef.current.removeSelected().catch(() => {}) });
    }
    return hints;
  }, [canOpenSelectedAction, canRemoveSelected, canUseSelectedBroker, editing]);

  usePaneFooter("broker-manager", () => {
    const info: PaneFooterSegment[] = [];
    if (summary) {
      info.push({ id: "summary", parts: [{ text: summary, tone: "muted" }] });
    }
    if (busy) {
      info.push({ id: "loading", parts: [{ text: busy, tone: "muted" }] });
    }
    if (message) {
      info.push({
        id: "error",
        parts: [{
          text: message,
          tone: isBrokerErrorMessage(message) ? "warning" : "muted",
        }],
      });
    }
    return {
      info,
      hints: footerHints,
    };
  }, [busy, footerHints, message, summary]);
}
