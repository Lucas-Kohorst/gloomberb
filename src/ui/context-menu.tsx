import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { t, tf } from "../i18n";
import { getSharedRegistry, type PluginRegistry } from "../plugins/registry";
import type { TickerFinancials } from "../types/financials";
import { TICKER_RESEARCH_PANE_ID } from "../types/config";
import type { TickerRecord } from "../types/ticker";
import { formatPlatformShortcutLabel, getShortcutDisplayMode, type ShortcutDisplayMode } from "../utils/shortcut-labels";
import {
  contextMenuDivider,
  hasRunnableContextMenuItem,
  type ContextMenuContext,
  type ContextMenuDividerItem,
  type ContextMenuItem,
} from "../types/context-menu";
import { useRendererHost, useUiCapabilities, useUiHost } from "./host";

export interface ContextMenuEventLike {
  preventDefault?: () => void;
  stopPropagation?: () => void;
}

interface RightClickSelectionGesture {
  selectedBefore: string;
  startedAt: number;
}

interface ContextMenuController {
  showContextMenu(
    context: ContextMenuContext,
    items: ContextMenuItem[],
    event?: ContextMenuEventLike,
  ): Promise<boolean>;
}

const ContextMenuControllerContext = createContext<ContextMenuController | null>(null);
const noopContextMenuController: ContextMenuController = {
  showContextMenu: async () => false,
};
const EDITABLE_SELECTOR = "input, textarea, [contenteditable='true']";
const MENU_SURFACE_SELECTOR = [
  "[data-gloom-context-menu-surface='true']",
  "[data-gloom-role='pane-header']",
  "[data-gloom-role='pane-float-toggle']",
  "[data-gloom-role='pane-action']",
  "[data-gloom-role='pane-close']",
  "[data-gloom-role='pane-restore']",
  "[data-gloom-role='status-bar']",
  "[data-gloom-role='tab-button']",
].join(", ");

function isDivider(item: ContextMenuItem): item is ContextMenuDividerItem {
  return item.type === "divider";
}

export function compactContextMenuItems(items: ContextMenuItem[]): ContextMenuItem[] {
  const result: ContextMenuItem[] = [];
  for (const item of items) {
    if (isDivider(item)) {
      if (result.length === 0 || isDivider(result[result.length - 1]!)) continue;
      result.push(item);
      continue;
    }
    if (item.hidden === true) continue;
    const nextItem = item.type === "normal" || item.type == null
      ? {
        ...item,
        submenu: item.submenu ? compactContextMenuItems(item.submenu) : undefined,
      }
      : item;
    if (nextItem.type !== "role" && nextItem.submenu && !hasRunnableContextMenuItem(nextItem.submenu)) {
      result.push({ ...nextItem, enabled: false, submenu: nextItem.submenu });
      continue;
    }
    result.push(nextItem);
  }

  while (result.length > 0 && isDivider(result[result.length - 1]!)) {
    result.pop();
  }
  return result;
}

function withSafeActions(
  items: ContextMenuItem[],
  onError: (error: unknown) => void,
): ContextMenuItem[] {
  return items.map((item) => {
    if (item.type === "divider" || item.type === "role") return item;
    return {
      ...item,
      submenu: item.submenu ? withSafeActions(item.submenu, onError) : undefined,
      onSelect: item.onSelect
        ? () => {
          try {
            const result = item.onSelect?.();
            if (result instanceof Promise) {
              void result.catch(onError);
            }
          } catch (error) {
            onError(error);
          }
        }
        : undefined,
    };
  });
}

function selectedTextTickerSymbol(text: string): string | null {
  const normalized = text.trim().toUpperCase();
  return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(normalized) ? normalized : null;
}

function elementTarget(target: EventTarget | null): HTMLElement | null {
  return target instanceof HTMLElement ? target : null;
}

function selectionText(): string {
  return window.getSelection()?.toString().trim() ?? "";
}

function clearBrowserSelection(): void {
  window.getSelection()?.removeAllRanges();
}

function selectedTextMenuItems(text: string, registry: PluginRegistry | null, copyText: (text: string) => Promise<void>): ContextMenuItem[] {
  const symbol = selectedTextTickerSymbol(text);
  const ticker = symbol ? registry?.getTickerFn(symbol) ?? null : null;
  const items: ContextMenuItem[] = [
    { type: "role", role: "copy", label: "Copy" },
  ];
  if (ticker && symbol) {
    items.push(
      contextMenuDivider("selected-text:ticker-divider"),
      {
        id: "selected-text:open-ticker",
        label: "Open Ticker Research",
        onSelect: () => registry?.navigateTicker(symbol),
      },
      {
        id: "selected-text:copy-symbol",
        label: "Copy Symbol",
        onSelect: () => { void copyText(symbol); },
      },
    );
  }
  return items;
}

export function editableTextContextMenuItems(): ContextMenuItem[] {
  return [
    { type: "role", role: "undo" },
    { type: "role", role: "redo" },
    contextMenuDivider("edit:history"),
    { type: "role", role: "cut" },
    { type: "role", role: "copy" },
    { type: "role", role: "paste" },
    contextMenuDivider("edit:selection"),
    { type: "role", role: "selectAll" },
  ];
}

export function linkContextMenuItems({
  url,
  open,
  copy,
}: {
  url: string;
  open: (url: string) => void;
  copy: (text: string) => void;
}): ContextMenuItem[] {
  return [
    {
      id: "link:open",
      label: "Open Link",
      onSelect: () => open(url),
    },
    {
      id: "link:copy",
      label: "Copy Link",
      onSelect: () => copy(url),
    },
  ];
}

function appContextMenuItems(registry: Pick<PluginRegistry, "openCommandBar"> | null): ContextMenuItem[] {
  return [
    {
      id: "app:command-bar",
      label: "Command Bar",
      onSelect: () => registry?.openCommandBar(),
    },
    {
      id: "app:layout-actions",
      label: "Layout Actions...",
      onSelect: () => registry?.openCommandBar("LMA "),
    },
    contextMenuDivider("app:config-divider"),
    {
      id: "app:plugins",
      label: "Manage Plugins...",
      onSelect: () => registry?.openCommandBar("PL "),
    },
    {
      id: "app:theme",
      label: "Change Theme...",
      onSelect: () => registry?.openCommandBar("TH "),
    },
    {
      id: "app:updates",
      label: "Check for Updates",
      onSelect: () => registry?.openCommandBar("Check for Updates"),
    },
  ];
}

export function tickerContextMenuItems({
  ticker,
  financials,
  registry,
  openTicker,
  openExternal,
  copyText,
}: {
  ticker: TickerRecord;
  financials: TickerFinancials | null;
  registry: PluginRegistry | null;
  openTicker?: (symbol: string) => void;
  openExternal: (url: string) => void | Promise<void>;
  copyText: (text: string) => Promise<void>;
}): ContextMenuItem[] {
  const symbol = ticker.metadata.ticker;
  const items: ContextMenuItem[] = [
    {
      id: "ticker:open",
      label: tf("Open {symbol} Ticker Research", { symbol }),
      onSelect: () => (openTicker ? openTicker(symbol) : registry?.navigateTicker(symbol)),
    },
    {
      id: "ticker:pin-floating",
      label: tf("Open {symbol} in New Floating Ticker Research", { symbol }),
      onSelect: () => registry?.pinTicker(symbol, { floating: true, paneType: TICKER_RESEARCH_PANE_ID, forceNewPane: true }),
    },
    {
      id: "ticker:chart",
      label: "Open chart",
      onSelect: () => registry?.openCommandBar(`GP ${symbol}`),
    },
    {
      id: "ticker:alert",
      label: "Set alert...",
      onSelect: () => registry?.openCommandBar(`SA ${symbol}`),
    },
    contextMenuDivider("ticker:collection-divider"),
    {
      id: "ticker:add-to",
      label: "Add to...",
      submenu: [
        {
          id: "ticker:add-watchlist",
          label: "Watchlist...",
          onSelect: () => registry?.openCommandBar(`AW ${symbol}`),
        },
        {
          id: "ticker:add-portfolio",
          label: "Portfolio...",
          onSelect: () => registry?.openCommandBar(`AP ${symbol}`),
        },
      ],
    },
    {
      id: "ticker:copy-symbol",
      label: "Copy ticker",
      onSelect: () => { void copyText(symbol); },
    },
    {
      id: "ticker:open-yahoo",
      label: "Open in Yahoo",
      onSelect: () => openExternal(`https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`),
    },
  ];

  if (ticker.metadata.watchlists.length > 0) {
    items.push({
      id: "ticker:remove-watchlist",
      label: "Remove from Watchlist...",
      onSelect: () => registry?.openCommandBar(`RW ${symbol}`),
    });
  }
  if (ticker.metadata.portfolios.length > 0) {
    items.push({
      id: "ticker:remove-portfolio",
      label: "Remove from Portfolio...",
      onSelect: () => registry?.openCommandBar(`RP ${symbol}`),
    });
  }

  const tickerActions = registry
    ? [...registry.tickerActions.values()].filter((action) => !action.filter || action.filter(ticker))
    : [];
  if (tickerActions.length > 0) {
    items.push(contextMenuDivider("ticker:actions-divider"));
    for (const action of tickerActions) {
      items.push({
        id: `ticker-action:${action.id}`,
        label: action.label,
        onSelect: () => { void action.execute(ticker, financials); },
      });
    }
  }

  return items;
}

function translateContextMenuItems(items: ContextMenuItem[]): ContextMenuItem[] {
  return items.map((item) => {
    if (item.type === "divider" || item.type === "role") return item;
    return {
      ...item,
      label: t(item.label),
      submenu: item.submenu ? translateContextMenuItems(item.submenu) : item.submenu,
    };
  });
}

/* ------------------------------------------------------------------ */
/* DOM fallback menu (desktop-web hosts without native context menus)  */
/* ------------------------------------------------------------------ */

const DOM_ROW_HEIGHT = 26;
const DOM_MENU_WIDTH = 224;

interface BuiltDomItem {
  key: string;
  /** null marks a divider row. */
  label: string | null;
  accelerator?: string;
  enabled?: boolean;
  checked?: boolean;
  submenu?: BuiltDomItem[];
  action: () => void;
}

interface DomMenuState {
  items: BuiltDomItem[];
  originKey: string;
  x: number;
  y: number;
}

const ROLE_LABELS: Record<string, string> = {
  undo: "Undo",
  redo: "Redo",
  cut: "Cut",
  copy: "Copy",
  paste: "Paste",
  pasteAndMatchStyle: "Paste and Match Style",
  delete: "Delete",
  selectAll: "Select All",
};

const noop = () => {};

function runNativeRole(role: string, copyText: (text: string) => Promise<void>): void {
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const activeIsEditable = !!activeElement && (
    activeElement.tagName === "INPUT"
    || activeElement.tagName === "TEXTAREA"
    || activeElement.isContentEditable
  );
  if (role === "copy" && (!activeIsEditable || !!document.getSelection()?.toString())) {
    const selected = document.getSelection()?.toString() ?? "";
    if (selected) {
      void copyText(selected);
      return;
    }
  }
  if (activeIsEditable && typeof document.execCommand === "function") {
    const command = role === "pasteAndMatchStyle" ? "paste" : role;
    document.execCommand(command);
    return;
  }
  if (role === "copy") {
    void copyText("");
  }
}

function buildDomMenuItems(
  items: ContextMenuItem[],
  copyText: (text: string) => Promise<void>,
  displayMode: ShortcutDisplayMode,
): BuiltDomItem[] {
  const result: BuiltDomItem[] = [];
  for (const item of items) {
    if (item.type === "divider") {
      if (result.length === 0 || result[result.length - 1]?.label === null) continue;
      result.push({ key: item.id ?? `divider:${result.length}`, label: null, action: noop });
      continue;
    }
    if (item.hidden === true) continue;
    if (item.type === "role") {
      result.push({
        key: `role:${item.role}`,
        label: ROLE_LABELS[item.role] ?? item.role,
        accelerator: item.accelerator ? formatPlatformShortcutLabel(item.accelerator, undefined, displayMode) : undefined,
        enabled: item.enabled !== false,
        action: () => runNativeRole(item.role, copyText),
      });
      continue;
    }
    const submenu = item.submenu ? buildDomMenuItems(item.submenu, copyText, displayMode) : undefined;
    const submenuRunnable = submenu ? submenu.some((entry) => entry.label !== null && entry.action !== noop) : false;
    result.push({
      key: item.id ?? item.label ?? `item:${result.length}`,
      label: item.label,
      accelerator: item.accelerator ? formatPlatformShortcutLabel(item.accelerator, undefined, displayMode) : undefined,
      enabled: item.enabled !== false && (!submenu || submenuRunnable),
      checked: item.checked,
      submenu: submenu && submenu.length > 0 ? submenu : undefined,
      action: item.onSelect ? () => { void item.onSelect?.(); } : noop,
    });
  }
  return result;
}

function domViewportWidth(): number {
  const el = typeof document !== "undefined" ? (document.documentElement?.clientWidth ?? 0) : 0;
  const win = typeof window !== "undefined" ? (window.innerWidth ?? 0) : 0;
  return Math.max(el, win) || 1024;
}

function domViewportHeight(): number {
  const el = typeof document !== "undefined" ? (document.documentElement?.clientHeight ?? 0) : 0;
  const win = typeof window !== "undefined" ? (window.innerHeight ?? 0) : 0;
  return Math.max(el, win) || 768;
}

function domPointerPosition(event: ContextMenuEventLike | undefined): { x: number; y: number } {
  const pointer = event as { pageX?: number; pageY?: number; clientX?: number; clientY?: number } | undefined;
  if (pointer && typeof pointer.pageX === "number" && typeof pointer.pageY === "number") {
    return { x: pointer.pageX, y: pointer.pageY };
  }
  if (pointer && typeof pointer.clientX === "number" && typeof pointer.clientY === "number") {
    const scrollX = typeof window !== "undefined" ? (window.scrollX ?? 0) : 0;
    const scrollY = typeof window !== "undefined" ? (window.scrollY ?? 0) : 0;
    return { x: pointer.clientX + scrollX, y: pointer.clientY + scrollY };
  }
  return { x: 0, y: 0 };
}

function clampDomMenuPosition(x: number, y: number, rowCount: number): { x: number; y: number } {
  const maxX = Math.max(0, domViewportWidth() - DOM_MENU_WIDTH - 8);
  const height = rowCount * DOM_ROW_HEIGHT + 24;
  const maxY = Math.max(0, domViewportHeight() - height);
  return { x: Math.max(0, Math.min(x, maxX)), y: Math.max(0, Math.min(y, maxY)) };
}

function translateMenuContextKey(context: ContextMenuContext): string {
  switch (context.kind) {
    case "ticker": return `ticker:${context.symbol}`;
    case "link": return `link:${context.url}`;
    case "pane": return `pane:${context.paneId}`;
    case "layout": return `layout:${context.layoutIndex}`;
    case "editable-text": return `edit:${context.selectedText ?? context.value ?? ""}`;
    case "selected-text": return `text:${context.text}`;
    case "app": return "app";
  }
}

function itemsAt(items: BuiltDomItem[], path: number[], depth: number): BuiltDomItem[] {
  let current = items;
  for (let level = 0; level < depth && current.length > 0; level += 1) {
    const index = Math.min(path[level] ?? 0, current.length - 1);
    const next = current[index]?.submenu;
    if (!next) break;
    current = next;
  }
  return current;
}

function DomMenuRow({
  item,
  selected,
  onHover,
  onSelect,
}: {
  item: BuiltDomItem;
  selected: boolean;
  onHover: () => void;
  onSelect: (item: BuiltDomItem) => void;
}) {
  if (item.label === null) {
    return <div style={{ height: 1, margin: "4px 8px", backgroundColor: "var(--gloom-border)" }} />;
  }
  const disabled = item.enabled === false;
  return (
    <div
      role={item.checked == null ? "menuitem" : "menuitemcheckbox"}
      tabIndex={-1}
      aria-checked={item.checked}
      aria-disabled={disabled ? "true" : undefined}
      aria-haspopup={item.submenu ? "true" : undefined}
      aria-expanded={item.submenu && selected ? "true" : undefined}
      data-gloom-interactive={disabled ? "false" : "true"}
      onMouseEnter={onHover}
      onClick={() => {
        if (!disabled) onSelect(item);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: DOM_ROW_HEIGHT,
        padding: "0 10px",
        boxSizing: "border-box",
        cursor: disabled ? "default" : "pointer",
        color: disabled ? "var(--gloom-text-dim)" : selected ? "var(--gloom-selected-text)" : "var(--gloom-text)",
        backgroundColor: selected ? "var(--gloom-selected)" : "transparent",
        whiteSpace: "nowrap",
        userSelect: "none",
      }}
    >
      <span style={{ flexGrow: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
        {item.label}
      </span>
      {item.accelerator && (
        <span style={{ color: "var(--gloom-text-dim)", fontSize: 11 }}>{item.accelerator}</span>
      )}
      {item.submenu && <span style={{ color: "var(--gloom-text-dim)" }}>›</span>}
    </div>
  );
}

function DomMenuColumn({
  items,
  depth,
  path,
  onSetPath,
  onSelect,
}: {
  items: BuiltDomItem[];
  depth: number;
  path: number[];
  onSetPath: (depth: number, index: number, expand: boolean) => void;
  onSelect: (item: BuiltDomItem) => void;
}) {
  const selectedIndex = Math.min(path[depth] ?? 0, Math.max(0, items.length - 1));
  const chosen = items[selectedIndex];
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        minWidth: DOM_MENU_WIDTH,
        padding: 4,
        boxSizing: "border-box",
        backgroundColor: "var(--gloom-panel)",
        border: "1px solid var(--gloom-border-focused)",
        borderRadius: 6,
        boxShadow: "0 18px 38px color-mix(in srgb, var(--gloom-bg) 46%, transparent)",
      }}
    >
      {items.map((item, index) => (
        <DomMenuRow
          key={item.key}
          item={item}
          selected={index === selectedIndex}
          onHover={() => onSetPath(depth, index, !!item.submenu)}
          onSelect={onSelect}
        />
      ))}
      {chosen?.submenu && path.length > depth + 1 && (
        <div style={{ position: "absolute", left: "100%", top: 0 }}>
          <DomMenuColumn
            items={chosen.submenu}
            depth={depth + 1}
            path={path}
            onSetPath={onSetPath}
            onSelect={onSelect}
          />
        </div>
      )}
    </div>
  );
}

function DomFallbackMenu({
  state,
  onClose,
}: {
  state: DomMenuState;
  onClose: () => void;
}) {
  const [path, setPath] = useState<number[]>([0]);
  const containerRef = useRef<HTMLDivElement>(null);

  const setIndexAtDepth = useCallback((depth: number, index: number, expand: boolean) => {
    setPath((prev) => {
      // Keep deeper selections when the hover is on the same open parent, so
      // moving across a submenu row does not collapse the flyout.
      if (expand && prev.length > depth + 1 && prev[depth] === index && prev[prev.length - 1] !== 0) return prev;
      return [...prev.slice(0, depth), index, ...(expand ? [0] : [])];
    });
  }, []);

  const selectItem = useCallback((item: BuiltDomItem) => {
    if (item.enabled === false || item.label === null) return;
    if (item.submenu) {
      setPath((prev) => [...prev.slice(0, prev.length), 0]);
      return;
    }
    onClose();
    item.action();
  }, [onClose]);

  const handleKeyDown = useCallback((event: { key: string; preventDefault?: () => void; stopPropagation?: () => void }) => {
    const depth = path.length - 1;
    if (event.key === "Escape") {
      event.stopPropagation?.();
      onClose();
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault?.();
      const items = itemsAt(state.items, path, depth);
      const item = items[path[depth] ?? 0];
      if (event.key === "ArrowRight" && item?.submenu) {
        setPath((prev) => [...prev.slice(0, prev.length), 0]);
      } else if (event.key === "ArrowLeft" && depth > 0) {
        setPath((prev) => prev.slice(0, -1));
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault?.();
      const items = itemsAt(state.items, path, depth);
      const currentIndex = path[depth] ?? 0;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const count = items.length;
      if (count === 0) return;
      let next = currentIndex;
      for (let step = 0; step < count; step += 1) {
        next = (next + delta + count) % count;
        if (items[next]?.label !== null && items[next]?.enabled !== false) break;
      }
      setIndexAtDepth(depth, next, false);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault?.();
      const items = itemsAt(state.items, path, depth);
      const item = items[path[depth] ?? 0];
      if (item) selectItem(item);
    }
  }, [onClose, path, selectItem, setIndexAtDepth, state.items]);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleOutsidePointerDown = (event: globalThis.PointerEvent | MouseEvent) => {
      const target = typeof Node !== "undefined" && event.target instanceof Node ? event.target : null;
      if (target && containerRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    document.addEventListener("mousedown", handleOutsidePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
      document.removeEventListener("mousedown", handleOutsidePointerDown, true);
    };
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      role="menu"
      tabIndex={-1}
      data-gloom-role="context-menu-fallback"
      onKeyDown={handleKeyDown}
      style={{
        position: "fixed",
        left: state.x,
        top: state.y,
        zIndex: 9999,
        outline: "none",
      }}
    >
      <DomMenuColumn
        items={state.items}
        depth={0}
        path={path}
        onSetPath={setIndexAtDepth}
        onSelect={selectItem}
      />
    </div>
  );
}


export function ContextMenuProvider({
  pluginRegistry,
  children,
}: {
  pluginRegistry?: PluginRegistry | null;
  children: ReactNode;
}) {
  const renderer = useRendererHost();
  const uiHost = useUiHost();
  const capabilities = useUiCapabilities();
  const rightClickSelectionRef = useRef<RightClickSelectionGesture | null>(null);
  const registry = pluginRegistry ?? getSharedRegistry() ?? null;
  const nativeSupported = capabilities.nativeContextMenu === true && typeof renderer.showContextMenu === "function";
  const displayMode = getShortcutDisplayMode(uiHost.kind);
  const [domMenu, setDomMenu] = useState<DomMenuState | null>(null);

  const handleActionError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    registry?.notify({ body: message || "Context menu action failed.", type: "error" });
  }, [registry]);

  const closeDomMenu = useCallback(() => setDomMenu(null), []);

  const showContextMenu = useCallback<ContextMenuController["showContextMenu"]>(async (context, localItems, event) => {
    const pluginItems = registry?.getContextMenuItems(context) ?? [];
    const items = compactContextMenuItems([
      ...localItems,
      ...(localItems.length > 0 && pluginItems.length > 0 ? [contextMenuDivider(`${context.kind}:plugin-divider`)] : []),
      ...pluginItems,
    ]);
    if (!hasRunnableContextMenuItem(items)) return false;

    event?.preventDefault?.();
    event?.stopPropagation?.();

    if (nativeSupported && renderer.showContextMenu) {
      return renderer.showContextMenu(withSafeActions(translateContextMenuItems(items), handleActionError));
    }

    if (typeof document === "undefined") return false;

    const translated = withSafeActions(translateContextMenuItems(items), handleActionError);
    const position = domPointerPosition(event);
    const rowCount = translated.filter((item) => item.type !== "divider").length;
    setDomMenu({
      items: buildDomMenuItems(translated, renderer.copyText.bind(renderer), displayMode),
      originKey: translateMenuContextKey(context),
      ...clampDomMenuPosition(position.x, position.y, rowCount),
    });
    return true;
  }, [displayMode, handleActionError, nativeSupported, registry, renderer]);

  useEffect(() => {
    if (!nativeSupported || typeof document === "undefined") return;
    const handleDocumentRightClickStart = (event: MouseEvent | PointerEvent) => {
      if (event.button !== 2) return;
      const target = elementTarget(event.target);
      if (target?.closest(EDITABLE_SELECTOR)) {
        rightClickSelectionRef.current = null;
        return;
      }

      const now = Date.now();
      if (!rightClickSelectionRef.current || now - rightClickSelectionRef.current.startedAt > 500) {
        rightClickSelectionRef.current = {
          selectedBefore: selectionText(),
          startedAt: now,
        };
      }
      event.preventDefault();
    };
    const handleDocumentSelectStart = (event: Event) => {
      if (!rightClickSelectionRef.current) return;
      const target = elementTarget(event.target);
      if (target?.closest(EDITABLE_SELECTOR)) return;
      event.preventDefault();
    };
    const handleDocumentContextMenu = (event: MouseEvent) => {
      const target = elementTarget(event.target);
      if (target?.closest(EDITABLE_SELECTOR)) return;
      const gesture = rightClickSelectionRef.current;
      let selected = selectionText();
      const browserCreatedSelection = !!gesture && !gesture.selectedBefore && !!selected;
      if (browserCreatedSelection) {
        clearBrowserSelection();
        selected = "";
      }
      globalThis.setTimeout(() => {
        if (rightClickSelectionRef.current === gesture) {
          rightClickSelectionRef.current = null;
        }
      }, 0);
      if (target?.closest(MENU_SURFACE_SELECTOR)) return;
      if (!selected) {
        void showContextMenu(
          { kind: "app" },
          appContextMenuItems(registry),
          event,
        );
        return;
      }
      void showContextMenu(
        { kind: "selected-text", text: selected },
        selectedTextMenuItems(selected, registry, renderer.copyText.bind(renderer)),
        event,
      );
    };
    document.addEventListener("pointerdown", handleDocumentRightClickStart, true);
    document.addEventListener("mousedown", handleDocumentRightClickStart, true);
    document.addEventListener("selectstart", handleDocumentSelectStart, true);
    document.addEventListener("contextmenu", handleDocumentContextMenu, true);
    return () => {
      document.removeEventListener("pointerdown", handleDocumentRightClickStart, true);
      document.removeEventListener("mousedown", handleDocumentRightClickStart, true);
      document.removeEventListener("selectstart", handleDocumentSelectStart, true);
      document.removeEventListener("contextmenu", handleDocumentContextMenu, true);
    };
  }, [nativeSupported, registry, renderer, showContextMenu]);

  const value = useMemo(() => ({ showContextMenu }), [showContextMenu]);
  return (
    <ContextMenuControllerContext value={value}>
      {children}
      {domMenu && (
        <DomFallbackMenu
          key={domMenu.originKey}
          state={domMenu}
          onClose={closeDomMenu}
        />
      )}
    </ContextMenuControllerContext>
  );
}

export function useContextMenu(): ContextMenuController {
  const context = useContext(ContextMenuControllerContext);
  if (!context) {
    return noopContextMenuController;
  }
  return context;
}

export function useTickerContextMenu({
  ticker,
  financials,
  onOpen,
}: {
  ticker: TickerRecord | null | undefined;
  financials?: TickerFinancials | null;
  onOpen?: (symbol: string) => void;
}) {
  const { showContextMenu } = useContextMenu();
  const renderer = useRendererHost();
  const registry = getSharedRegistry() ?? null;
  return useCallback((event?: ContextMenuEventLike) => {
    if (!ticker) return Promise.resolve(false);
    return showContextMenu(
      {
        kind: "ticker",
        symbol: ticker.metadata.ticker,
        ticker,
        financials: financials ?? null,
      },
      tickerContextMenuItems({
        ticker,
        financials: financials ?? null,
        registry,
        openTicker: onOpen,
        openExternal: renderer.openExternal.bind(renderer),
        copyText: renderer.copyText.bind(renderer),
      }),
      event,
    );
  }, [financials, onOpen, registry, renderer, showContextMenu, ticker]);
}

/** Row surfaces (tables, grids) pick the ticker per event, so the menu is built per right-click. */
export function useTickerRowContextMenu(
  financialsMap: Map<string, TickerFinancials>,
): (ticker: TickerRecord, event?: ContextMenuEventLike) => Promise<boolean> {
  const { showContextMenu } = useContextMenu();
  const renderer = useRendererHost();
  return useCallback((ticker, event) => {
    const financials = financialsMap.get(ticker.metadata.ticker) ?? null;
    return showContextMenu(
      {
        kind: "ticker",
        symbol: ticker.metadata.ticker,
        ticker,
        financials,
      },
      tickerContextMenuItems({
        ticker,
        financials,
        registry: getSharedRegistry() ?? null,
        openExternal: renderer.openExternal.bind(renderer),
        copyText: renderer.copyText.bind(renderer),
      }),
      event,
    );
  }, [financialsMap, renderer, showContextMenu]);
}
