import { useMemo, useRef } from "react";
import { usePaneFooter, type PaneFooterSegment, type PaneHint } from "../../../components";
import type { BrokerManagerMessage } from "./pane-actions";

interface BrokerManagerFooterActions {
  connectSelected: () => Promise<void>;
  startAdd: () => void;
  openProfileAction: () => void;
  removeSelected: () => void;
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
  message,
}: {
  actions: BrokerManagerFooterActions;
  canOpenSelectedAction: boolean;
  canRemoveSelected: boolean;
  canUseSelectedBroker: boolean;
  /** Editing a profile or adding one. */
  editing: boolean;
  /** The last result of an action, or null. */
  message: BrokerManagerMessage | null;
}) {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const footerHints = useMemo<PaneHint[]>(() => {
    // Enter to save and Esc to cancel are app-wide form conventions, and the edit
    // and add forms render their own buttons, so the footer stays empty.
    if (editing) return [];

    const hints: PaneHint[] = [
      { id: "add", key: "a", label: "dd", onPress: () => actionsRef.current.startAdd() },
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
      hints.push({ id: "disconnect", key: "d", label: "isconnect", onPress: () => actionsRef.current.removeSelected() });
    }
    return hints;
  }, [canOpenSelectedAction, canRemoveSelected, canUseSelectedBroker, editing]);

  const info = useMemo<PaneFooterSegment[]>(() => [
    ...(message ? [{ id: "message", parts: [{ text: message.text, tone: message.tone === "error" ? "negative" as const : "muted" as const }] }] : []),
  ], [message]);

  usePaneFooter("broker-manager", () => ({
    info,
    hints: footerHints,
  }), [footerHints, info]);
}
