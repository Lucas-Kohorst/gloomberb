import {
  useCallback,
  useId,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import {
  TextAttributes,
  tickerContextMenuItems,
  useCommandBarShortcut,
  useContextMenu,
  useRendererHost,
  useUiCapabilities,
  type ScrollBoxRenderable,
} from "../../ui";
import { colors } from "../../theme/colors";
import { t, tf } from "../../i18n";
import { getSharedRegistry } from "../../plugins/registry";
import { withPluginContextMenuItems } from "../../ui/context-menu";
import type { ContextMenuItem } from "../../types/context-menu";
import type { ColumnConfig } from "../../types/config";
import type { TickerFinancials, PricePoint } from "../../types/financials";
import type { TickerRecord } from "../../types/ticker";
import { PRICE_SPARKLINE_COLUMN_ID, PriceSparkline } from "../price-sparkline/view";
import { DataTableView, type DataTableKeyEvent, type DataTableSelection } from "../data-table/view";
import type { QuoteFlashDirection } from "../quote-flash";
import { objectVersion } from "../../utils/object-version";
import { getCompletedRegularSessionDisplay } from "../../market-data/market/status";
import { usePaneFooter } from "../layout/pane/footer";

export interface TickerTableCell {
  text: string;
  color?: string;
}

type ResolveTickerTableCell = (
  column: ColumnConfig,
  ticker: TickerRecord,
  financials: TickerFinancials | undefined,
) => TickerTableCell;

export interface TickerListVisibleRange {
  start: number;
  end: number;
}

export interface TickerListSectionRow {
  kind: "section";
  id: string;
  label: string;
}

export type TickerListRow = TickerRecord | TickerListSectionRow;

function isTickerRow(item: TickerListRow): item is TickerRecord {
  return "metadata" in item;
}

function getTickerListRowKey(item: TickerListRow): string {
  return isTickerRow(item) ? item.metadata.ticker : `section:${item.id}`;
}

export interface TickerListTableViewProps {
  columns: ColumnConfig[];
  tickers: TickerRecord[];
  cursorSymbol: string | null;
  setCursorSymbol: (symbol: string) => void;
  /**
   * Fires on every cursor move, before the debounced selection commit. Use it
   * for work that should track the cursor rather than the selection, such as
   * warming the rows the cursor is about to land on.
   */
  onCursorChange?: (ticker: TickerRecord, index: number) => void;
  resolveCell: ResolveTickerTableCell;
  financialsMap: Map<string, TickerFinancials>;
  focused?: boolean;
  rootBefore?: ReactNode;
  rootAfter?: ReactNode;
  rootWidth?: number;
  rootHeight?: number;
  rootBackgroundColor?: string;
  headerScrollRef?: RefObject<ScrollBoxRenderable | null>;
  scrollRef?: RefObject<ScrollBoxRenderable | null>;
  syncHeaderScroll?: () => void;
  onBodyScrollActivity?: () => void;
  keyboardNavigation?: boolean;
  onRootKeyDown?: (event: DataTableKeyEvent) => boolean | void;
  onVisibleRangeChange?: (range: TickerListVisibleRange) => void;
  visibleRangeBuffer?: number;
  resetScrollKey?: unknown;
  flashSymbols?: Map<string, QuoteFlashDirection>;
  sortColumnId?: string | null;
  sortDirection?: "asc" | "desc";
  onHeaderClick?: (columnId: string) => void;
  onRowActivate?: (ticker: TickerRecord) => void;
  /**
   * Section headers mixed into the ticker rows. Headers are not selectable.
   * Omit it and the table is the ticker list alone.
   */
  rows?: readonly TickerListRow[];
  /** The pane's own keys for row menu actions, by item id, shown beside them in the pane menu. */
  rowMenuAccelerators?: Readonly<Record<string, string>>;
  emptyTitle?: string;
  emptyHint?: string;
  virtualize?: boolean;
  overscan?: number;
}

const FLASHABLE_QUOTE_COLUMN_IDS = new Set([
  "price",
  "change",
  "change_pct",
  "bid",
  "ask",
  "spread",
  "spread_pct",
  "ext_hours",
  "market_cap",
  "volume",
  "dollar_volume",
  "range_52w",
  "mkt_value",
  "weight",
  "day_pnl",
  "pnl",
  "pnl_pct",
  "mark_delta",
]);

// After the regular close, and in the pre-market with the last session's close
// and move, these three hold that close and its move while only the extended
// print ticks (see the portfolio column values), so a tick does not flash them.
const STEADY_AFTER_CLOSE_QUOTE_COLUMN_IDS = new Set(["price", "change", "change_pct"]);

const EMPTY_FLASH_SYMBOLS = new Map<string, QuoteFlashDirection>();

/** Whether a tick on this row dims the cell: the quote columns it can move. */
export function flashesOnQuoteTick(columnId: string, quote: TickerFinancials["quote"]): boolean {
  if (!FLASHABLE_QUOTE_COLUMN_IDS.has(columnId)) return false;
  return !STEADY_AFTER_CLOSE_QUOTE_COLUMN_IDS.has(columnId) || !getCompletedRegularSessionDisplay(quote);
}

type TableMouseEvent = {
  button?: number;
  detail?: number;
  preventDefault?: () => void;
  stopPropagation?: () => void;
};

function getPriceHistory(financials: TickerFinancials | undefined): PricePoint[] | undefined {
  return financials?.priceHistory;
}

/** What right-clicking the row offers, plugin additions included. */
function tickerRowMenuItems(
  ticker: TickerRecord,
  financials: TickerFinancials | null,
  copyText: (text: string) => Promise<void>,
): ContextMenuItem[] {
  const registry = getSharedRegistry() ?? null;
  return withPluginContextMenuItems(
    { kind: "ticker", symbol: ticker.metadata.ticker, ticker, financials },
    tickerContextMenuItems({ ticker, financials, registry, copyText }),
    registry,
  );
}

/**
 * A ticker's right-click menu, for the keyboard: the pane menu (".", Shift+F10,
 * the Menu key) lists it first while `enabled`. The ticker table registers its
 * cursor row; a surface with a cursor of its own (a treemap) registers that.
 */
export function useTickerRowPaneMenu({
  ticker,
  financials,
  enabled,
  accelerators,
}: {
  ticker: TickerRecord | null;
  financials: TickerFinancials | null;
  enabled: boolean;
  /** The pane's own keys for these actions, by item id, shown beside them. */
  accelerators?: Readonly<Record<string, string>>;
}): void {
  const renderer = useRendererHost();
  const registrationId = `ticker-row-menu:${useId()}`;
  usePaneFooter(registrationId, () => {
    if (!enabled || !ticker) return null;
    const items = tickerRowMenuItems(ticker, financials, renderer.copyText.bind(renderer));
    return {
      order: -1,
      menu: accelerators
        ? items.map((item) => (item.type === "divider" || item.type === "role" || !accelerators[item.id]
          ? item
          : { ...item, accelerator: accelerators[item.id] }))
        : items,
    };
  }, [accelerators, enabled, financials, renderer, ticker]);
}

export function TickerListTableView({
  focused = false,
  rootBefore,
  rootAfter,
  rootWidth,
  rootHeight,
  rootBackgroundColor,
  headerScrollRef,
  scrollRef,
  syncHeaderScroll,
  onBodyScrollActivity,
  keyboardNavigation = true,
  onRootKeyDown,
  onVisibleRangeChange,
  visibleRangeBuffer,
  resetScrollKey,
  columns,
  tickers,
  cursorSymbol,
  setCursorSymbol,
  onCursorChange,
  resolveCell,
  financialsMap,
  flashSymbols,
  sortColumnId,
  sortDirection = "asc",
  onHeaderClick,
  onRowActivate,
  rows,
  rowMenuAccelerators,
  emptyTitle = t("No tickers."),
  emptyHint,
  virtualize = true,
  overscan = 4,
}: TickerListTableViewProps) {
  const commandBarShortcut = useCommandBarShortcut();
  const resolvedEmptyHint = emptyHint ?? tf("Press {shortcut} to add one.", { shortcut: commandBarShortcut });
  const renderer = useRendererHost();
  const { showContextMenu } = useContextMenu();
  const { nativeContextMenu } = useUiCapabilities();
  const safeFlashSymbols = flashSymbols ?? EMPTY_FLASH_SYMBOLS;
  const items = (rows ?? tickers) as TickerListRow[];
  const sectioned = rows != null;
  const selectedIndex = useMemo(
    () => items.findIndex((item) => isTickerRow(item) && item.metadata.ticker === cursorSymbol),
    [cursorSymbol, items],
  );

  // A quote tick replaces the financials map and the flash set. The cell
  // renderer reads both through refs so it keeps one identity, and each row's
  // version carries its own records and flash, so one symbol's tick redraws
  // one row. A new `resolveCell` (another column context: FX, weights, the
  // AGE clock) still redraws every visible row through its epoch.
  const financialsRef = useRef(financialsMap);
  financialsRef.current = financialsMap;
  const flashSymbolsRef = useRef(safeFlashSymbols);
  flashSymbolsRef.current = safeFlashSymbols;
  const resolveCellRef = useRef({ resolve: resolveCell, epoch: 0 });
  if (resolveCellRef.current.resolve !== resolveCell) {
    resolveCellRef.current = { resolve: resolveCell, epoch: resolveCellRef.current.epoch + 1 };
  }
  const resolveEpoch = resolveCellRef.current.epoch;

  const renderCell = useCallback((
    ticker: TickerListRow,
    column: ColumnConfig,
    _index: number,
    rowState: { selected: boolean },
  ) => {
    if (!isTickerRow(ticker)) return { text: "" };
    const financials = financialsRef.current.get(ticker.metadata.ticker);
    if (column.id === PRICE_SPARKLINE_COLUMN_ID) {
      return {
        text: ticker.metadata.ticker,
        content: <PriceSparkline priceHistory={getPriceHistory(financials)} width={column.width} />,
      };
    }

    const { text, color } = resolveCellRef.current.resolve(column, ticker, financials);
    const shouldFlash = flashSymbolsRef.current.has(ticker.metadata.ticker)
      && flashesOnQuoteTick(column.id, financials?.quote);
    return {
      text,
      color: color || (rowState.selected ? colors.selectedText : undefined),
      attributes: shouldFlash ? TextAttributes.DIM : TextAttributes.NONE,
    };
  }, []);

  const getRowVersion = useCallback((ticker: TickerListRow) => {
    if (!isTickerRow(ticker)) return ticker.id;
    const symbol = ticker.metadata.ticker;
    return `${resolveEpoch}|${objectVersion(financialsMap.get(symbol))}|${safeFlashSymbols.get(symbol) ?? ""}`;
  }, [financialsMap, resolveEpoch, safeFlashSymbols]);

  const selection = useMemo<DataTableSelection<TickerListRow>>(() => ({
    kind: "id",
    selectedId: cursorSymbol,
    getId: getTickerListRowKey,
    onChange: (symbol) => {
      setCursorSymbol(symbol);
    },
  }), [cursorSymbol, setCursorSymbol]);

  const handleActivate = useCallback((ticker: TickerListRow) => {
    if (isTickerRow(ticker)) onRowActivate?.(ticker);
  }, [onRowActivate]);

  const handleCursorChange = useCallback((ticker: TickerListRow, index: number) => {
    if (isTickerRow(ticker)) onCursorChange?.(ticker, index);
  }, [onCursorChange]);

  const reportVisibleRange = useCallback((range: TickerListVisibleRange) => {
    if (!onVisibleRangeChange) return;
    const tickerIndexAt = (itemIndex: number) => {
      let count = 0;
      const end = Math.min(Math.max(itemIndex, 0), items.length);
      for (let index = 0; index < end; index += 1) {
        if (isTickerRow(items[index]!)) count += 1;
      }
      return count;
    };
    onVisibleRangeChange({ start: tickerIndexAt(range.start), end: tickerIndexAt(range.end) });
  }, [items, onVisibleRangeChange]);

  const showTickerContextMenu = useCallback((
    ticker: TickerListRow,
    event: TableMouseEvent,
  ) => {
    if (!isTickerRow(ticker)) return;
    const financials = financialsRef.current.get(ticker.metadata.ticker);
    const registry = getSharedRegistry() ?? null;
    void showContextMenu(
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
        copyText: renderer.copyText.bind(renderer),
      }),
      event,
    );
  }, [renderer, showContextMenu]);

  const handleRowMouseDown = useCallback((ticker: TickerListRow, _index: number, event: TableMouseEvent) => {
    if (!isTickerRow(ticker)) return false;
    if (event.button !== 2) return false;
    if (nativeContextMenu !== true) {
      showTickerContextMenu(ticker, event);
    }
    return true;
  }, [nativeContextMenu, showTickerContextMenu]);

  const handleRowContextMenu = useCallback((ticker: TickerListRow, _index: number, event: TableMouseEvent) => {
    if (!isTickerRow(ticker)) return;
    showTickerContextMenu(ticker, event);
  }, [showTickerContextMenu]);

  // The cursor row's right-click menu, for the keyboard, while the table is focused.
  const cursorItem = selectedIndex >= 0 ? items[selectedIndex] : undefined;
  const cursorTicker = cursorItem && isTickerRow(cursorItem) ? cursorItem : null;
  const cursorFinancials = cursorTicker ? financialsMap.get(cursorTicker.metadata.ticker) ?? null : null;
  useTickerRowPaneMenu({
    ticker: cursorTicker,
    financials: cursorFinancials,
    enabled: focused && keyboardNavigation,
    accelerators: rowMenuAccelerators,
  });

  return (
    <DataTableView<TickerListRow, ColumnConfig>
      focused={focused}
      columns={columns}
      items={items}
      sortColumnId={sortColumnId ?? null}
      sortDirection={sortDirection}
      onHeaderClick={onHeaderClick}
      getItemKey={getTickerListRowKey}
      selection={selection}
      onCursorChange={handleCursorChange}
      onActivate={handleActivate}
      onRowMouseDown={handleRowMouseDown}
      onRowContextMenu={handleRowContextMenu}
      rowContextMenuSurface
      renderCell={renderCell}
      renderSectionHeader={sectioned
        ? (item) => isTickerRow(item) ? null : { text: item.label }
        : undefined}
      isNavigable={sectioned ? isTickerRow : undefined}
      getRowVersion={getRowVersion}
      emptyStateTitle={emptyTitle}
      emptyStateHint={resolvedEmptyHint}
      virtualize={virtualize}
      overscan={overscan}
      rootBefore={rootBefore}
      rootAfter={rootAfter}
      rootWidth={rootWidth}
      rootHeight={rootHeight}
      rootBackgroundColor={rootBackgroundColor}
      headerScrollRef={headerScrollRef}
      scrollRef={scrollRef}
      syncHeaderScroll={syncHeaderScroll}
      onBodyScrollActivity={onBodyScrollActivity}
      onVisibleRangeChange={sectioned ? reportVisibleRange : onVisibleRangeChange}
      visibleRangeBuffer={visibleRangeBuffer}
      keyboardNavigation={keyboardNavigation}
      onRootKeyDown={onRootKeyDown}
      resetScrollKey={resetScrollKey}
    />
  );
}
