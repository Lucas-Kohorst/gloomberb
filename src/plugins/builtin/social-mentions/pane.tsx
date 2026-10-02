import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiRequestError } from "../../../api-client/errors";
import type { SocialMentionPost, SocialMentionsRange } from "../../../api-client/social-mentions";
import {
  DataTableStackView,
  EmptyState,
  PaneStatusBody,
  type DataTableCell,
} from "../../../components";
import { CompositeChart } from "../../../components/chart/composite";
import { staticSeries } from "../../../components/chart/static/series";
import {
  useAsyncResource,
  useAutoRefresh,
  usePaneSettingValue,
  usePaneTicker,
  usePluginPaneState,
  useShortcut,
} from "../../../public/react";
import { colors } from "../../../theme/colors";
import type { PaneProps } from "../../../types/plugin";
import { Box, ScrollBox, Text, useRendererHost, useUiCapabilities } from "../../../ui";
import { isPlainKey } from "../../../utils/keyboard";
import { SignInWall } from "../cloud/auth-actions";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import { cachedSocialMentions, loadSocialMentionPosts, loadSocialMentions } from "./client";
import {
  SOCIAL_COLUMNS,
  cashtagSymbol,
  socialChartPoints,
  socialCount,
  socialDayRows,
  socialRatio,
  socialStance,
  socialSummary,
  sortedSocialRows,
  stanceWord,
  topPostCell,
  type SocialColumn,
  type SocialDayRow,
  type SocialSort,
} from "./model";

const PANELS = [{ id: "main" }];
const WITH_WIKI_PANELS = [{ id: "main", height: 2 }, { id: "wiki", height: 1 }];
const PENDING_RETRY_MS = 5_000;
const RANGES: SocialMentionsRange[] = ["1y", "5y", "max"];

const clearDenied = (error: unknown) => error instanceof ApiRequestError && [401, 403].includes(error.status ?? 0);
const sessionRequired = (error: string | null) => !!error && (/\b(401|403)\b|\bunauthorized\b|\bforbidden\b|\bsign in\b|\bverif/i.test(error));
const stanceColor = (value: number | null) => value == null ? colors.textMuted : value >= .15 ? colors.positive : value <= -.15 ? colors.negative : colors.text;

function renderCell(row: SocialDayRow, column: SocialColumn, _index: number, state: { selected: boolean }): DataTableCell {
  const text = column.id === "day" ? row.day
    : column.id === "mentions" ? socialCount(row.mentions)
      : column.id === "ratio" ? socialRatio(row.ratio)
        : column.id === "wikiViews" ? socialCount(row.wikiViews)
          : column.id === "redditMentions" ? socialCount(row.redditMentions)
            : column.id === "stance" ? socialStance(row.stance)
              : topPostCell(row.topPost);
  if (state.selected) return { text, color: colors.selectedText };
  return {
    text,
    color: column.id === "stance" ? stanceColor(row.stance)
      : column.id === "ratio" && (row.ratio ?? 0) >= 2.5 ? colors.warning
        : column.id === "topPost" || column.id === "wikiViews" || column.id === "redditMentions" || !row.closed ? colors.textMuted
          : colors.text,
  };
}

function PostBlock({ post, width }: { post: SocialMentionPost; width: number }) {
  const rendererHost = useRendererHost();
  const open = useCallback(() => {
    if (!post.url) return;
    void rendererHost.openExternal(post.url);
  }, [post.url, rendererHost]);
  return (
    <Box
      flexDirection="column"
      width={width}
      onMouseDown={post.url ? open : undefined}
      data-gloom-interactive={post.url ? "true" : undefined}
    >
      <Box flexDirection="row" gap={2}>
        <Text fg={colors.text} wrapMode="none" truncate flexShrink={1} minWidth={0}>@{post.author}</Text>
        <Text fg={colors.textMuted} wrapMode="none">{post.views == null ? `${socialCount(post.likes)} likes` : `${socialCount(post.views)} views`}</Text>
        <Text fg={stanceColor(post.stance)} wrapMode="none">{socialStance(post.stance)}</Text>
      </Box>
      <Text fg={colors.textMuted} width={width} wrapMode="word">{post.text.replace(/\s+\n/g, "\n").trim()}</Text>
    </Box>
  );
}

function SummaryStrip({ width, items }: {
  width: number;
  items: Array<{ id: string; label: string; value: string; detail?: string }>;
}) {
  return (
    <Box flexDirection="row" flexWrap="wrap" width={width} paddingX={1} gap={2}>
      {items.map((item) => (
        <Box key={item.id} flexDirection="row" gap={1}>
          <Text fg={colors.textMuted} wrapMode="none">{item.label}</Text>
          <Text fg={colors.text} wrapMode="none">{item.value}</Text>
          {item.detail ? <Text fg={colors.textMuted} wrapMode="none">{item.detail}</Text> : null}
        </Box>
      ))}
    </Box>
  );
}

function DayDetail({ symbol, row, recent, width, height, onUrl }: {
  symbol: string;
  row: SocialDayRow;
  recent: SocialMentionPost[];
  width: number;
  height: number;
  onUrl: (url: string | null) => void;
}) {
  const { nativePaneChrome } = useUiCapabilities();
  const loader = useCallback(() => loadSocialMentionPosts(symbol, row.day), [symbol, row.day]);
  const posts = useAsyncResource(row.closed ? loader : null);
  const list = (row.closed ? posts.data : null) ?? recent.filter((post) => post.day === row.day);
  const lineWidth = Math.max(1, width - 2);
  const url = list.find((post) => post.url)?.url ?? row.topPost?.url ?? null;
  useEffect(() => {
    onUrl(url);
  }, [onUrl, url]);
  return (
    <Box flexDirection="column" flexGrow={1} flexBasis={0} minHeight={0}>
      <SummaryStrip width={width} items={[
        { id: "posts", label: "Posts", value: socialCount(row.mentions), detail: row.closed ? undefined : "so far" },
        { id: "ratio", label: "Vs median", value: socialRatio(row.ratio) },
        { id: "stance", label: "Stance", value: socialStance(row.stance), detail: stanceWord(row.stance) },
      ]} />
      <ScrollBox
        width={width}
        height={nativePaneChrome ? undefined : Math.max(1, height - 3)}
        flexGrow={1}
        flexBasis={0}
        minHeight={0}
        scrollY
        focusable={false}
      >
        <Box paddingX={1} width={width}>
          <PaneStatusBody
            loading={posts.loading && !list.length}
            error={!list.length ? posts.error : null}
            subject="top posts"
            empty={!posts.loading && !list.length}
            emptyTitle="No top posts for this day."
          >
            <Box flexDirection="column" gap={1} width={lineWidth}>
              {list.map((post) => <PostBlock key={post.id} post={post} width={lineWidth} />)}
            </Box>
          </PaneStatusBody>
        </Box>
      </ScrollBox>
    </Box>
  );
}

export function SocialMentionsPane({ width, height, focused }: PaneProps) {
  const { symbol: tickerKey, ticker } = usePaneTicker();
  const [rangeValue] = usePaneSettingValue("socialRange", "1y");
  const range: SocialMentionsRange = RANGES.includes(rangeValue as SocialMentionsRange) ? rangeValue as SocialMentionsRange : "1y";
  const boundKey = ticker?.metadata.ticker ?? tickerKey;
  const symbol = cashtagSymbol(boundKey);
  const loader = useCallback((force: boolean) => loadSocialMentions(symbol!, range, force), [symbol, range]);
  const resource = useAsyncResource(symbol ? loader : null, {
    initialData: () => symbol ? cachedSocialMentions(symbol, range) : null,
    clearOnError: clearDenied,
  });
  const data = resource.data?.payload;
  const identity = `${range}:${symbol}`;
  const [sort, setSort] = usePluginPaneState<SocialSort>("social-mentions:sort", { column: "day", direction: "desc" });
  const [selectedId, setSelectedId] = usePluginPaneState<string | null>("social-mentions:selected", null);
  const [openId, setOpenId] = usePluginPaneState<string | null>("social-mentions:open", null);
  const [detailUrl, setDetailUrl] = useState<string | null>(null);
  const rowKey = useCallback((row: SocialDayRow) => `${identity}:${row.day}`, [identity]);
  const allRows = useMemo(() => data ? socialDayRows(data) : [], [data]);
  const rows = useMemo(() => sortedSocialRows(allRows, sort), [allRows, sort]);
  const summary = useMemo(() => data ? socialSummary(data, allRows) : null, [data, allRows]);
  const selectedIndex = Math.max(0, rows.findIndex((row) => rowKey(row) === selectedId));
  const openRow = rows.find((row) => rowKey(row) === openId);
  const selected = openRow ?? rows[selectedIndex];
  const hasWiki = allRows.some((row) => row.wikiViews !== null);
  const series = useMemo(() => {
    const posts = staticSeries(socialChartPoints(allRows), {
      id: "x-posts",
      label: "Posts on X",
      color: colors.warning,
      style: "columns",
      calendarSpaced: true,
    });
    if (!hasWiki) return [posts];
    const wiki = staticSeries(socialChartPoints(allRows, (row) => row.wikiViews), {
      id: "wiki-views",
      label: "Wikipedia views",
      color: colors.borderFocused,
      calendarSpaced: true,
    });
    return [posts, { ...wiki, panelId: "wiki" }];
  }, [allRows, hasWiki]);
  const chartHeight = height >= 16 ? Math.max(5, Math.min(12, Math.floor(height * .38))) : 0;
  const pending = !!data?.pending.length;
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => void resource.reload(), PENDING_RETRY_MS);
    return () => clearTimeout(timer);
  }, [pending, resource.updatedAt, resource.reload]);
  useEffect(() => {
    if (!openRow) setDetailUrl(null);
  }, [openRow]);
  useAutoRefresh(resource.updatedAt, resource.load);
  useShortcut((event) => {
    if (focused && isPlainKey(event, "r")) {
      event.preventDefault();
      void resource.reload();
    }
  });
  const postUrl = (openRow ? detailUrl : null) ?? selected?.topPost?.url ?? null;
  usePaneStatusLinkFooter({
    registrationId: "social-mentions",
    focused,
    loading: resource.loading || pending,
    error: resource.error ?? resource.data?.refreshError ?? null,
    url: postUrl,
    showOpenHint: !!postUrl,
    info: resource.data?.stale
      ? [{ id: "stale", parts: [{ text: "stale", tone: "warning" as const }] }]
      : [],
  });
  const onDetailUrl = useCallback((url: string | null) => {
    setDetailUrl(url);
  }, []);

  if (!data && sessionRequired(resource.error)) {
    return <SignInWall action="view social mentions" needsVerification={/verif/i.test(resource.error ?? "")} />;
  }
  if (!boundKey?.trim()) return <EmptyState title="No ticker selected." message="Select a ticker to view social mentions." />;
  if (!symbol) {
    return (
      <EmptyState
        title="This ticker cannot be searched as a cashtag."
        message="Use a symbol of up to six letters and digits, starting with a letter."
      />
    );
  }

  const latest = summary?.latest ?? null;
  return (
    <Box flexDirection="column" width={width} height={height}>
      <PaneStatusBody
        loading={resource.loading && !data}
        error={!data ? resource.error : null}
        subject="social mentions"
        empty={!resource.loading && !resource.error && !!data && !data.x.days.length && !pending}
        emptyTitle="No mention history yet."
      >
        {data ? (
          <DataTableStackView<SocialDayRow, SocialColumn>
            focused={focused}
            rootWidth={width}
            rootHeight={height}
            emptyStateTitle="Counting mentions."
            columns={SOCIAL_COLUMNS}
            items={rows}
            freezeFirstColumn
            getItemKey={rowKey}
            renderCell={renderCell}
            resetScrollKey={identity}
            selection={{
              kind: "index",
              selectedIndex: rows.length ? selectedIndex : -1,
              onChange: (index) => setSelectedId(rows[index] ? rowKey(rows[index]!) : null),
            }}
            onActivate={(row) => setOpenId(rowKey(row))}
            detailOpen={!!openRow}
            onBack={() => setOpenId(null)}
            detailTitle={openRow?.day}
            detailContent={openRow
              ? (
                <DayDetail
                  symbol={symbol}
                  row={openRow}
                  recent={data.topPosts}
                  width={width}
                  height={Math.max(3, height - 2)}
                  onUrl={onDetailUrl}
                />
              )
              : null}
            sortColumnId={sort.column}
            sortDirection={sort.direction}
            onHeaderClick={(column) => setSort((current) => ({
              column: column as SocialSort["column"],
              direction: current.column === column && current.direction === "desc" ? "asc" : "desc",
            }))}
            rootBefore={(
              <Box flexDirection="column" flexShrink={0}>
                <SummaryStrip width={width} items={[
                  {
                    id: "posts",
                    label: "Posts",
                    value: socialCount(latest?.mentions),
                    detail: latest ? `${socialRatio(latest.ratio)} median · ${latest.day.slice(5)}` : undefined,
                  },
                  { id: "median", label: "30D median", value: socialCount(data.x.baseline) },
                  {
                    id: "stance",
                    label: "Stance 7D",
                    value: socialStance(summary?.stance ?? null),
                    detail: stanceWord(summary?.stance ?? null),
                  },
                  {
                    id: "peak",
                    label: `Peak ${range === "max" ? "all" : range.toUpperCase()}`,
                    value: socialCount(summary?.peak?.mentions),
                    detail: summary?.peak?.day,
                  },
                  ...(summary?.wiki ? [{
                    id: "wiki",
                    label: "Wiki views",
                    value: socialCount(summary.wiki.views),
                    detail: `${socialRatio(summary.wiki.ratio)} median · ${summary.wiki.day.slice(5)}`,
                  }] : []),
                  ...(summary?.reddit ? [{
                    id: "reddit",
                    label: "Reddit",
                    value: socialCount(summary.reddit.mentions),
                    detail: `${socialRatio(summary.reddit.ratio)} median · ${summary.reddit.day.slice(5)}`,
                  }] : []),
                ]} />
                {data.warnings.length ? (
                  <Text fg={colors.warning} wrapMode="word">{data.warnings.join(" ")}</Text>
                ) : null}
                {chartHeight && allRows.length ? (
                  <Box paddingX={1} flexShrink={0}>
                    <CompositeChart
                      series={series}
                      panels={hasWiki ? WITH_WIKI_PANELS : PANELS}
                      width={Math.max(1, width - 2)}
                      height={chartHeight}
                      focused={focused && !openRow}
                      showLegend={hasWiki}
                      showTimeAxis
                      navigable={false}
                      formatAxisValue={(value) => socialCount(value)}
                      remoteKind="social-mentions-history"
                    />
                  </Box>
                ) : null}
              </Box>
            )}
          />
        ) : null}
      </PaneStatusBody>
    </Box>
  );
}
