import { useCallback } from "react";
import { Box, Text, TextAttributes } from "../ui";
import { useDialogKeyboard, type AlertContext } from "../ui/dialog";
import { t } from "../i18n";
import { colors } from "../theme/colors";
import { Button } from "../components/ui";
import { readPaneFooterHints, type PaneHint } from "../components/layout/pane/footer";
import type { KeyEventLike } from "../react/input";

interface GlobalCheatsheetAction {
  id: string;
  key: string;
  label: string;
  matches(event: KeyEventLike): boolean;
  execute(): void;
}

function matchesPaneHint(event: KeyEventLike, hint: PaneHint): boolean {
  if (event.ctrl || event.meta || event.super || event.alt) return false;
  const key = event.name ?? event.key ?? event.sequence;
  return key === hint.key || key?.toLowerCase() === hint.key.toLowerCase();
}

function afterDismiss(dismiss: () => void, action: () => void) {
  dismiss();
  queueMicrotask(action);
}

export function ContextualCheatsheet({
  dialogId,
  dismiss,
  paneId,
  actions,
}: AlertContext & {
  paneId: string | null;
  actions: GlobalCheatsheetAction[];
}) {
  const hints = readPaneFooterHints(paneId);
  const runPaneHint = useCallback((hint: PaneHint) => {
    if (hint.onPress) afterDismiss(dismiss, () => hint.onPress?.());
  }, [dismiss]);
  const runAction = useCallback((action: GlobalCheatsheetAction) => {
    afterDismiss(dismiss, action.execute);
  }, [dismiss]);

  useDialogKeyboard((event) => {
    const hint = hints.find((candidate) => matchesPaneHint(event, candidate));
    if (hint?.onPress) {
      event.preventDefault();
      event.stopPropagation();
      runPaneHint(hint);
      return;
    }
    const action = actions.find((candidate) => candidate.matches(event));
    if (action) {
      event.preventDefault();
      event.stopPropagation();
      runAction(action);
    }
  }, dialogId);

  return (
    <Box width={56} flexDirection="column" gap={1} data-gloom-role="contextual-cheatsheet">
      <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{t("This pane")}</Text>
      {hints.length > 0 ? (
        <Box flexDirection="column">
          {hints.map((hint) => (
            <Button
              key={hint.id}
              label={`${hint.key}  ${hint.label}`}
              variant="ghost"
              onPress={hint.onPress ? () => runPaneHint(hint) : undefined}
            />
          ))}
        </Box>
      ) : (
        <Text fg={colors.textMuted}>{t("No actions are registered for this pane.")}</Text>
      )}
      <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{t("Global")}</Text>
      <Box flexDirection="column">
        {actions.map((action) => (
          <Button
            key={action.id}
            label={`${action.key}  ${action.label}`}
            variant="ghost"
            onPress={() => runAction(action)}
          />
        ))}
      </Box>
      <Text fg={colors.textMuted}>{t("Esc or click outside to close.")}</Text>
    </Box>
  );
}

export function createGlobalCheatsheetActions({
  openCommandBar,
  openTickerSearch,
  refreshFocused,
  refreshAll,
  focusNextPane,
  openHelp,
}: {
  openCommandBar(): void;
  openTickerSearch(): void;
  refreshFocused(): void;
  refreshAll(): void;
  focusNextPane(): void;
  openHelp(): void;
}): GlobalCheatsheetAction[] {
  return [
    {
      id: "command-bar",
      key: "Ctrl+P / Cmd+K",
      label: t("Command bar"),
      matches: (event) => (event.name === "p" && event.ctrl === true)
        || (event.name === "k" && (event.ctrl === true || event.meta === true || event.super === true)),
      execute: openCommandBar,
    },
    {
      id: "ticker-search",
      key: "`",
      label: t("Ticker search"),
      matches: (event) => event.name === "`",
      execute: openTickerSearch,
    },
    {
      id: "refresh-focused",
      key: "r",
      label: t("Refresh focused ticker"),
      matches: (event) => !event.shift && event.name === "r",
      execute: refreshFocused,
    },
    {
      id: "refresh-all",
      key: "Shift+R",
      label: t("Refresh all tickers"),
      matches: (event) => event.name === "R" || (event.name === "r" && event.shift),
      execute: refreshAll,
    },
    {
      id: "focus-next",
      key: "Tab",
      label: t("Focus next pane"),
      matches: (event) => event.name === "tab" && !event.shift,
      execute: focusNextPane,
    },
    {
      id: "all-shortcuts",
      key: "?",
      label: t("All shortcuts"),
      matches: (event) => event.name === "?" || event.key === "?" || event.sequence === "?"
        || (event.name === "/" && event.shift),
      execute: openHelp,
    },
  ];
}
