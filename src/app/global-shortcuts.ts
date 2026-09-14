import { createElement, type Dispatch } from "react";
import { useShortcut } from "../react/input";
import { useNativeRenderer, useRendererHost, useUiHost } from "../ui";
import { isLayoutSwitchShortcut, layoutSwitchUsesOption } from "../utils/layout-switch-shortcut";
import { useDialog, useDialogState } from "../ui/dialog";
import type { PluginRegistry } from "../plugins/registry";
import type { AppAction, AppState } from "../state/app/context";
import type { TickerRecord } from "../types/ticker";
import type { ReleaseInfo } from "../updater";
import { canSelfUpdate } from "../updater";
import { getVisiblePaneCycleOrder } from "../components/layout/pane/cycle-order";
import {
  copyActiveSelection,
  isCopyShortcut,
  isPasteShortcut,
  pasteSystemClipboard,
} from "../utils/selection-clipboard";
import { ContextualCheatsheet, createGlobalCheatsheetActions } from "./contextual-cheatsheet";
import {
  matchesKeybinding,
  resolveKeybindings,
} from "./keybindings";

export function useAppGlobalShortcuts({
  dispatch,
  focusedTickerSymbol,
  isDetachedWindow,
  pluginRegistry,
  refreshTicker,
  startUpdate,
  state,
}: {
  dispatch: Dispatch<AppAction>;
  focusedTickerSymbol: string | null;
  isDetachedWindow: boolean;
  pluginRegistry: PluginRegistry;
  refreshTicker: (symbol: string, exchange?: string, tickerOverride?: TickerRecord | null, priority?: number) => void;
  startUpdate: (release: ReleaseInfo) => void;
  state: AppState;
}) {
  const dialogOpen = useDialogState((s) => s.isOpen);
  const dialog = useDialog();
  const nativeRenderer = useNativeRenderer();
  const rendererHost = useRendererHost();
  const uiHost = useUiHost();
  const optionLayoutSwitch = layoutSwitchUsesOption({
    kind: uiHost.kind,
    nativePaneChrome: uiHost.capabilities?.nativePaneChrome,
  });

  useShortcut((event) => {
    if (isCopyShortcut(event) && copyActiveSelection(nativeRenderer)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (isPasteShortcut(event) && pasteSystemClipboard(nativeRenderer)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // Terminals send Ctrl; the browser and the desktop webview send Cmd on
    // macOS, which the OpenTUI host also reports as `super` under the kitty
    // protocol. Alt stays out so Alt-digit keeps its terminal meaning. While a
    // dialog, the command bar or an editable field owns the keyboard the digit
    // must not move layouts, but it still has to be swallowed there or the
    // webview hands Cmd-digit to the browser's own tab switcher.
    if (!isDetachedWindow
      && /^[1-9]$/.test(event.name ?? "")
      && (event.ctrl || event.meta || event.super)) {
      const layouts = state.config.layouts ?? [];
      const idx = parseInt(event.name!, 10) - 1;
      const uiOwnsKeyboard = dialogOpen || state.commandBarOpen || event.targetEditable === true;
      if (!uiOwnsKeyboard && idx < layouts.length && idx !== state.config.activeLayoutIndex) {
        dispatch({ type: "SWITCH_LAYOUT", index: idx });
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (dialogOpen) return;

    const eventBinding = {
      key: (event.name === "?" || event.key === "?" || event.sequence === "?")
        ? "/"
        : (event.name ?? event.key ?? "").toLowerCase(),
      ctrl: event.ctrl || event.meta || event.super,
      shift: event.shift,
      alt: event.alt,
    };
    const resolvedShortcuts = resolveKeybindings(state.config, pluginRegistry.shortcuts.values());
    const matchedShortcut = resolvedShortcuts.find((shortcut) => matchesKeybinding(shortcut, eventBinding));

    if (!isDetachedWindow && (
      matchedShortcut?.id === "global.command-bar"
      || matchedShortcut?.id === "global.command-bar-alternate"
    )) {
      event.preventDefault();
      event.stopPropagation();
      dispatch({ type: "TOGGLE_COMMAND_BAR" });
      return;
    }
    if (!isDetachedWindow && matchedShortcut?.id === "global.ticker-search" && !state.commandBarOpen) {
      event.preventDefault();
      event.stopPropagation();
      dispatch({
        type: "SET_COMMAND_BAR",
        open: true,
        query: "",
        launch: { kind: "ticker-search", query: "" },
      });
      return;
    }

    if (state.commandBarOpen) return;

    if (isDetachedWindow || event.targetEditable === true) return;

    if (matchedShortcut?.id === "global.undo-layout") {
      event.preventDefault();
      event.stopPropagation();
      dispatch({ type: "UNDO_LAYOUT" });
      return;
    }
    if (matchedShortcut?.id === "global.redo-layout" || matchedShortcut?.id === "global.redo-layout-alternate") {
      event.preventDefault();
      event.stopPropagation();
      dispatch({ type: "REDO_LAYOUT" });
      return;
    }

    if (matchedShortcut?.id === "global.focus-next" || matchedShortcut?.id === "global.focus-previous") {
      const paneOrder = getVisiblePaneCycleOrder(
        state.config.layout,
        pluginRegistry,
        state.config.disabledPlugins,
      );
      if (paneOrder.length === 0) return;

      if (matchedShortcut.id === "global.focus-previous") {
        dispatch({ type: "FOCUS_PREV", paneOrder });
      } else {
        dispatch({ type: "FOCUS_NEXT", paneOrder });
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (state.inputCaptured) return;

    if (matchedShortcut?.id === "global.help") {
      event.preventDefault();
      event.stopPropagation();
      const paneOrder = getVisiblePaneCycleOrder(
        state.config.layout,
        pluginRegistry,
        state.config.disabledPlugins,
      );
      void dialog.alert({
        size: "small",
        style: { width: 60, maxHeight: 26 },
        closeOnClickOutside: true,
        content: (context: { dialogId: string; dismiss(): void }) => (
          createElement(ContextualCheatsheet, {
            ...context,
            paneId: state.focusedPaneId,
            actions: createGlobalCheatsheetActions({
              openCommandBar: () => dispatch({ type: "TOGGLE_COMMAND_BAR" }),
              openTickerSearch: () => dispatch({
                type: "SET_COMMAND_BAR",
                open: true,
                query: "",
                launch: { kind: "ticker-search", query: "" },
              }),
              refreshFocused: () => {
                if (!focusedTickerSymbol) return;
                const ticker = state.tickers.get(focusedTickerSymbol);
                if (ticker) refreshTicker(ticker.metadata.ticker, ticker.metadata.exchange, ticker, 0);
              },
              refreshAll: () => {
                for (const ticker of state.tickers.values()) {
                  refreshTicker(ticker.metadata.ticker, ticker.metadata.exchange, ticker, 1);
                }
              },
              focusNextPane: () => {
                if (paneOrder.length > 0) dispatch({ type: "FOCUS_NEXT", paneOrder });
              },
              openHelp: () => pluginRegistry.showPane("help"),
            }),
          })
        ),
      });
      return;
    }

    if (matchedShortcut?.id === "global.quit") {
      rendererHost.requestExit();
    } else if (matchedShortcut?.id === "global.refresh") {
      if (focusedTickerSymbol) {
        const ticker = state.tickers.get(focusedTickerSymbol);
        if (ticker) refreshTicker(ticker.metadata.ticker, ticker.metadata.exchange, ticker, 0);
      }
    } else if (matchedShortcut?.id === "global.refresh-all") {
      for (const ticker of state.tickers.values()) {
        refreshTicker(ticker.metadata.ticker, ticker.metadata.exchange, ticker, 1);
      }
    } else if (matchedShortcut?.id === "global.update" && state.updateAvailable && !state.updateProgress && !state.updateCheckInProgress && canSelfUpdate(state.updateAvailable)) {
      startUpdate(state.updateAvailable);
    } else {
      const disabledPlugins = new Set(state.config.disabledPlugins || []);
      for (const shortcut of resolvedShortcuts) {
        if (shortcut.group !== "plugin") continue;
        const ownerId = pluginRegistry.getShortcutPluginId(shortcut.id);
        if (ownerId && disabledPlugins.has(ownerId)) continue;
        if (shortcut.id === matchedShortcut?.id) {
          pluginRegistry.shortcuts.get(shortcut.id)?.execute();
          break;
        }
      }
    }
  }, { phase: "before" });
}
