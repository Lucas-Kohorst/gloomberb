import { useCallback, useEffect, useMemo, type ReactNode, type RefObject } from "react";
import { TextAttributes, type ScrollBoxRenderable } from "../../../../../ui";
import {
  DataTableStackView,
  PaneStatusBody,
  TickerEmptyState,
  TickerBadgeList,
  sortStackItems,
  type DataTableCell,
  type DataTableColumn,
  type StackSortPreference,
} from "../../../../../components";
import { TABLE_COLUMN_GAP, tableColumnWidth } from "../../../../../components/ui/table-layout";
import type { MarketNewsItem } from "../../../../../types/news-source";
import { blendHex, colors } from "../../../../../theme/colors";
import { formatNewsCategoryLabel } from "../../../../../news/news-model";
import { collectNewsDisplayTickers } from "../../../../../news/ticker-symbols";
import { newsOriginLabel } from "../../../../../news/origins";
import { formatRelativeTime } from "../../../../../utils/datetime-format";
import { isPlainKey } from "../../../../../utils/keyboard";
import { truncateWithEllipsis } from "../../../../../utils/text-wrap";
import { formatNewsCategory } from "../categories";
import { useRecentlyArrivedIds } from "../../../../../components/data-table/use-recently-arrived-ids";

export type NewsColumnId =
  | "rank"
  | "time"
  | "origin"
  | "source"
  | "title"
  | "tickers"
  | "categories"
  | "sentiment"
  | "importance";

const SENTIMENT_ORDER: Record<string, number> = { negative: -1, neutral: 0, positive: 1 };

export function buildNewsArticleRowRevision(
  article: MarketNewsItem,
  read: boolean,
  title = article.title,
): string {
  return [
    article.id,
    article.publishedAt.getTime(),
    read ? 1 : 0,
    title,
  ].join(":");
}

/**
 * Ticker badges are laid out by content, so a column that cannot fit them all
 * bleeds stray characters into the next column. Keep only the badges that fit.
 */
function fitTickerSymbols(symbols: string[], width: number): string[] {
  const fitted: string[] = [];
  let used = 0;
  for (const symbol of symbols) {
    const badgeWidth = symbol.length + 3;
    if (used + badgeWidth > width) break;
    used += badgeWidth;
    fitted.push(symbol);
  }
  return fitted;
}

/**
 * Body for a table with no rows yet: loading while the query is in flight, the
 * failure when the sources errored, and the empty state otherwise. Always own
 * the body rather than falling back to the table's built-in empty state, whose
 * desktop markup runs the title and the hint together on one line.
 */
export function newsTableStatusContent({
  loading,
  error,
  subject,
  ticker,
  emptyTitle,
  emptyMessage,
}: {
  loading: boolean;
  error?: string | null;
  subject: string;
  ticker?: string;
  emptyTitle: string;
  emptyMessage?: string;
}): ReactNode {
  if (ticker && !loading) {
    return <TickerEmptyState kind="news" symbol={ticker} detail="news" error={error} />;
  }
  return (
    <PaneStatusBody
      loading={loading}
      error={error}
      empty
      subject={subject}
      emptyTitle={emptyTitle}
      emptyMessage={emptyMessage}
    />
  );
}

export type NewsSortPreference = StackSortPreference<NewsColumnId>;

/** Paint/sort/arrival cap shared by industry, breaking, and feed tables. */
export const NEWS_TABLE_MAX_ROWS = 200;

export function takeNewsTableHead<T>(
  articles: readonly T[],
  limit = NEWS_TABLE_MAX_ROWS,
): T[] {
  if (articles.length <= limit) return articles as T[];
  return articles.slice(0, limit);
}

type NewsTableColumn = DataTableColumn & { id: NewsColumnId };

interface NewsArticleStackBaseProps {
  articles: MarketNewsItem[];
  focused: boolean;
  width: number;
  readArticleIds?: ReadonlySet<string>;
  selectedArticleId: string | null;
  setSelectedArticleId: (articleId: string | null) => void;
  sortPreference: NewsSortPreference;
  setSortPreference: (preference: NewsSortPreference) => void;
  onOpenArticle: (article: MarketNewsItem) => void;
  onArticleRead?: (articleId: string) => void;
  columns: NewsColumnId[];
  emptyContent?: ReactNode;
  emptyStateTitle: string;
  emptyStateHint?: string;
  titleForArticle?: (article: MarketNewsItem) => string;
  scrollRef?: RefObject<ScrollBoxRenderable | null>;
  onBodyScrollActivity?: () => void;
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, "en-US", { sensitivity: "base" });
}

function compareArticle(a: MarketNewsItem, b: MarketNewsItem, columnId: NewsColumnId): number {
  switch (columnId) {
    case "rank":
    case "importance":
      return a.importance - b.importance;
    case "time":
      return a.publishedAt.getTime() - b.publishedAt.getTime();
    case "origin":
      return compareText(newsOriginLabel(a.origin), newsOriginLabel(b.origin));
    case "source":
      return compareText(a.source, b.source);
    case "title":
      return compareText(a.title, b.title);
    case "tickers":
      return compareText(
        collectNewsDisplayTickers(a.tickers).join(" "),
        collectNewsDisplayTickers(b.tickers).join(" "),
      );
    case "categories":
      return compareText(a.categories.join(" "), b.categories.join(" "));
    case "sentiment":
      return (SENTIMENT_ORDER[a.sentiment ?? ""] ?? 0) - (SENTIMENT_ORDER[b.sentiment ?? ""] ?? 0);
  }
}

function sortNewsArticles(
  articles: MarketNewsItem[],
  preference: NewsSortPreference,
): MarketNewsItem[] {
  return sortStackItems(
    articles,
    preference,
    compareArticle,
    (a, b) => b.publishedAt.getTime() - a.publishedAt.getTime(),
  );
}

function nextSortPreference(current: NewsSortPreference, columnId: NewsColumnId): NewsSortPreference {
  if (current.columnId === columnId) {
    return {
      columnId,
      direction: current.direction === "asc" ? "desc" : "asc",
    };
  }
  return {
    columnId,
    direction: columnId === "title" || columnId === "source" || columnId === "categories"
      || columnId === "origin"
      ? "asc"
      : "desc",
  };
}

function buildColumns(width: number, columnIds: NewsColumnId[]): NewsTableColumn[] {
  const fixedWidths: Record<Exclude<NewsColumnId, "title">, number> = {
    rank: 4,
    time: 4,
    origin: 8,
    source: 12,
    tickers: 18,
    categories: 10,
    sentiment: 4,
    // Wide enough to keep the sort indicator next to the label.
    importance: 7,
  };
  const labels: Record<NewsColumnId, string> = {
    rank: "#",
    time: "TIME",
    origin: "ORIGIN",
    source: "SOURCE",
    title: "HEADLINE",
    tickers: "TICKERS",
    categories: "CATEGORY",
    sentiment: "SENT",
    importance: "SCORE",
  };

  // A column occupies its header-floored width plus the gap, and the table adds
  // one cell of padding on each side. Anything the fixed columns do not take is
  // the headline's, so the last column never falls off the right edge.
  const fixedTotal = columnIds
    .filter((id) => id !== "title")
    .reduce((sum, id) => sum + tableColumnWidth({
      width: fixedWidths[id as Exclude<NewsColumnId, "title">],
      label: labels[id],
    }) + TABLE_COLUMN_GAP, 0);
  const tablePadding = 2;
  const titleWidth = Math.max(16, width - fixedTotal - tablePadding - TABLE_COLUMN_GAP);

  return columnIds.map((id) => ({
    id,
    label: labels[id],
    width: id === "title" ? titleWidth : fixedWidths[id],
    align: id === "rank" || id === "importance" ? "right" : "left",
    flexGrow: id === "title" ? 1 : undefined,
  }));
}

interface NewsArticleStackViewProps extends NewsArticleStackBaseProps {
  detailOpen: boolean;
  onBack: () => void;
  detailContent: ReactNode;
  detailTitle?: string;
  rootBefore?: ReactNode;
  rootHeight?: number;
  onRootKeyDown?: (event: {
    name?: string;
    preventDefault?: () => void;
    stopPropagation?: () => void;
  }) => boolean | void;
  onPopOut?: () => void;
  onShare?: () => void;
}

export function NewsArticleStackView({
  articles,
  focused,
  width,
  readArticleIds,
  rootHeight,
  selectedArticleId,
  setSelectedArticleId,
  sortPreference,
  setSortPreference,
  onOpenArticle,
  onArticleRead,
  detailOpen,
  onBack,
  scrollRef,
  onBodyScrollActivity,
  detailContent,
  detailTitle,
  rootBefore,
  onRootKeyDown,
  onPopOut,
  onShare,
  columns: columnIds,
  emptyContent,
  emptyStateTitle,
  emptyStateHint,
  titleForArticle,
}: NewsArticleStackViewProps) {
  const tableArticles = useMemo(
    () => takeNewsTableHead(articles),
    [articles],
  );
  const sortedArticles = useMemo(
    () => sortNewsArticles(tableArticles, sortPreference),
    [tableArticles, sortPreference],
  );
  const articleIds = useMemo(
    () => sortedArticles.map((article) => article.id),
    [sortedArticles],
  );
  const arrivingArticleIds = useRecentlyArrivedIds(articleIds);
  const selectedIdx = sortedArticles.findIndex((article) => article.id === selectedArticleId);
  const columns = useMemo(() => buildColumns(width, columnIds), [columnIds, width]);

  const openArticle = useCallback((article: MarketNewsItem) => {
    onArticleRead?.(article.id);
    onOpenArticle(article);
  }, [onArticleRead, onOpenArticle]);

  const selectArticle = useCallback((
    id: string,
    _article: MarketNewsItem,
  ) => {
    setSelectedArticleId(id);
  }, [setSelectedArticleId]);

  const getRowBackgroundColor = useCallback((
    item: MarketNewsItem,
    _index: number,
    rowState: { selected: boolean },
  ) => {
    if (rowState.selected || !arrivingArticleIds.has(item.id)) return undefined;
    return blendHex(colors.bg, colors.selected, 0.34);
  }, [arrivingArticleIds]);

  const isRowArriving = useCallback((item: MarketNewsItem) => {
    return arrivingArticleIds.has(item.id);
  }, [arrivingArticleIds]);

  useEffect(() => {
    if (sortedArticles.length === 0) {
      if (selectedArticleId !== null) setSelectedArticleId(null);
      return;
    }
    if (selectedArticleId === null || selectedIdx < 0) {
      setSelectedArticleId(sortedArticles[0]!.id);
    }
  }, [selectedArticleId, selectedIdx, setSelectedArticleId, sortedArticles]);

  const renderCell = useCallback((
    item: MarketNewsItem,
    column: NewsTableColumn,
    index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "rank":
        return { text: String(index + 1), color: selectedColor ?? colors.textDim };
      case "time":
        return { text: formatRelativeTime(item.publishedAt), color: selectedColor ?? colors.textDim };
      case "origin":
        return { text: newsOriginLabel(item.origin), color: selectedColor ?? colors.textDim };
      case "source":
        return {
          text: truncateWithEllipsis(item.source, column.width),
          color: selectedColor ?? colors.textMuted,
        };
      case "title": {
        const read = readArticleIds?.has(item.id) === true;
        return {
          text: truncateWithEllipsis(titleForArticle?.(item) ?? item.title, column.width),
          color: read ? colors.textMuted : (selectedColor ?? colors.text),
          attributes: read ? TextAttributes.NONE : TextAttributes.BOLD,
        };
      }
      case "tickers": {
        const tickers = fitTickerSymbols(collectNewsDisplayTickers(item.tickers), column.width);
        return {
          text: tickers.join(" "),
          content: (
            <TickerBadgeList
              symbols={tickers}
              width={column.width}
              fallbackColor={selectedColor ?? colors.textBright}
              liveQuote={false}
            />
          ),
          color: selectedColor ?? colors.textBright,
        };
      }
      case "categories":
        return {
          text: truncateWithEllipsis(formatNewsCategory(item.categories[0]) || "-", column.width),
          color: selectedColor ?? colors.textDim,
        };
      case "sentiment": {
        const sentiment = item.sentiment;
        return {
          text: sentiment ? sentiment.slice(0, 3) : "-",
          color: selectedColor ?? (
            sentiment === "positive"
              ? colors.positive
              : sentiment === "negative"
                ? colors.negative
                : colors.textDim
          ),
        };
      }
      case "importance":
        return {
          text: String(item.importance),
          color: selectedColor ?? (item.importance >= 80 ? colors.positive : colors.textDim),
        };
    }
  }, [readArticleIds, titleForArticle]);

  const getRowRevision = useCallback((article: MarketNewsItem) => {
    return buildNewsArticleRowRevision(
      article,
      readArticleIds?.has(article.id) === true,
      titleForArticle?.(article),
    );
  }, [readArticleIds, titleForArticle]);

  const handleDetailKeyDown = useCallback((event: {
    name?: string;
    preventDefault?: () => void;
    stopPropagation?: () => void;
  }) => {
    if (onShare && isPlainKey(event, "y")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      onShare();
      return true;
    }
    if (!onPopOut || !isPlainKey(event, "p")) return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    if (selectedArticleId) onArticleRead?.(selectedArticleId);
    onPopOut();
    return true;
  }, [onArticleRead, onPopOut, onShare, selectedArticleId]);

  return (
    <DataTableStackView<MarketNewsItem, NewsTableColumn>
      focused={focused}
      detailOpen={detailOpen}
      onBack={onBack}
      detailContent={detailContent}
      detailTitle={detailTitle}
      selection={{
        kind: "id",
        selectedId: selectedArticleId,
        getId: (article) => article.id,
        onChange: selectArticle,
      }}
      onActivate={openArticle}
      rootBefore={rootBefore}
      rootHeight={rootHeight}
      onRootKeyDown={onRootKeyDown}
      onDetailKeyDown={handleDetailKeyDown}
      columns={columns}
      items={sortedArticles}
      sortColumnId={sortPreference.columnId}
      sortDirection={sortPreference.direction}
      onHeaderClick={(columnId) => setSortPreference(nextSortPreference(sortPreference, columnId as NewsColumnId))}
      getItemKey={(item) => item.id}
      getRowRevision={getRowRevision}
      getRowBackgroundColor={getRowBackgroundColor}
      isRowArriving={isRowArriving}
      renderCell={renderCell}
      emptyContent={emptyContent}
      emptyStateTitle={emptyStateTitle}
      emptyStateHint={emptyStateHint}
      showHorizontalScrollbar={false}
      scrollRef={scrollRef}
      onBodyScrollActivity={onBodyScrollActivity}
    />
  );
}
