import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, ScrollBox, Text, TextAttributes, type InputRenderable } from "../../../ui";
import { useShortcut } from "../../../react/input";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import {
  DataTableStackView,
  EmptyState,
  InputSearchBar,
  Spinner,
  nextStackSortPreference,
  sortStackItems,
  usePaneFooter,
  useUpdatedAgo,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
  type DataTableRootKeyContext,
  type StackSortPreference,
} from "../../../components";
import { CompositeChart, pricePointsToResolvedSeries } from "../../../components/chart/composite";
import { colors } from "../../../theme/colors";
import { isPlainKey } from "../../../utils/keyboard";
import { openUrl } from "../../../components/ui/external-link";
import type { PaneProps } from "../../../types/plugin";
import { usePaneInstance } from "../../../state/app/context";
import { usePluginPaneState } from "../../runtime";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { parseOwidShortcutArg, seriesJoinKey } from "../../../sources/owid/parse";
import type { OwidChartPrint, OwidChartSearchHit, OwidObservation } from "../../../sources/owid/types";
import { fetchOwidChart, fetchOwidChartSearch } from "./client";
import { entityLatestRows } from "./normalize";
import {
  OWID_PANE_ID,
  OWID_STATE_ENTITY,
  OWID_STATE_QUERY,
  OWID_STATE_SLUG,
} from "./types";

type LoadStatus = "idle" | "loading" | "loaded" | "error";
type ChartSortId = "title" | "slug";
type EntitySortId = "entity" | "code" | "latest";
type SeriesSortId = "time" | "value";

interface ChartColumn extends DataTableColumn { id: ChartSortId }
interface EntityColumn extends DataTableColumn { id: EntitySortId }
interface SeriesColumn extends DataTableColumn { id: SeriesSortId }

function formatValue(value: number | null): string {
  if (value == null) return "—";
  if (Math.abs(value) >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}

function OwidSeriesDetail({
  print,
  width,
  height,
}: {
  print: OwidChartPrint;
  width: number;
  height: number;
}) {
  const points = print.observations.flatMap((row) => {
    if (row.value == null) return [];
    const date = print.timeKind === "day"
      ? new Date(`${row.time}T00:00:00Z`)
      : new Date(`${row.time}-01-01T00:00:00Z`);
    if (!Number.isFinite(date.getTime())) return [];
    return [{ date, close: row.value }];
  });
  const series = points.length > 0
    ? [pricePointsToResolvedSeries(points, {
      id: seriesJoinKey(print.slug, print.entity?.code ?? "series"),
      label: print.columnTitle ?? print.title,
      color: colors.positive,
      unit: print.unit ?? "",
      unitGroup: "owid",
      style: "line",
      nativeFrequency: print.timeKind === "day" ? "daily" : "monthly",
      providerId: "owid",
      panelId: "main",
    })]
    : [];
  const chartHeight = Math.min(12, Math.max(7, Math.floor(height * 0.45)));
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} paddingTop={1} flexDirection="column">
        <Text fg={colors.textDim}>
          {print.slug}:{print.entity?.code ?? "—"}
          {print.unit ? ` · ${print.unit}` : ""}
          {` · ${print.license}`}
        </Text>
        {print.citation ? (
          <Text fg={colors.textMuted} wrapMode="word">{print.citation}</Text>
        ) : null}
      </Box>
      {series.length > 0 ? (
        <CompositeChart
          width={width}
          height={chartHeight}
          focused={false}
          interactive={false}
          series={series}
          panels={[{ id: "main", scale: "linear" }]}
          axisWidth={8}
          showLegend={false}
          showTimeAxis={true}
          formatValue={(value: number) => formatValue(value)}
        />
      ) : null}
      <ScrollBox flexGrow={1} scrollY>
        <Box flexDirection="column" paddingX={1} paddingBottom={1}>
          {print.observations.slice().reverse().slice(0, 80).map((row) => (
            <Text key={`${row.code}-${row.time}`} fg={colors.text}>
              {`${row.time}  ${formatValue(row.value)}`}
            </Text>
          ))}
        </Box>
      </ScrollBox>
    </Box>
  );
}

export function OwidPane({ paneId, focused, width, height }: PaneProps) {
  const paneInstance = usePaneInstance();
  const seededRef = useRef(false);
  const [query, setQuery] = usePluginPaneState<string>(OWID_STATE_QUERY, "", paneId);
  const [slug, setSlug] = usePluginPaneState<string>(OWID_STATE_SLUG, "", paneId);
  const [entity, setEntity] = usePluginPaneState<string>(OWID_STATE_ENTITY, "", paneId);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hits, setHits] = useState<OwidChartSearchHit[]>([]);
  const [print, setPrint] = useState<OwidChartPrint | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [listFilter, setListFilter] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);
  const [selectedChartId, setSelectedChartId] = useState<string | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [chartSort, setChartSort] = useState<StackSortPreference<ChartSortId>>({ columnId: "title", direction: "asc" });
  const [entitySort, setEntitySort] = useState<StackSortPreference<EntitySortId>>({ columnId: "entity", direction: "asc" });
  const [seriesSort, setSeriesSort] = useState<StackSortPreference<SeriesSortId>>({ columnId: "time", direction: "desc" });
  const updatedAgo = useUpdatedAgo(lastUpdated);

  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    const parsed = parseOwidShortcutArg(
      typeof paneInstance?.params?.query === "string" ? paneInstance.params.query : "",
    );
    if (!query && parsed.query) setQuery(parsed.query);
    if (!slug && parsed.slug) setSlug(parsed.slug);
    if (!entity && parsed.entity) setEntity(parsed.entity);
  }, [entity, paneInstance?.params?.query, query, setEntity, setQuery, setSlug, slug]);

  const loadSearch = useCallback(async (nextQuery: string) => {
    setStatus("loading");
    setError(null);
    try {
      const result = await fetchOwidChartSearch(nextQuery);
      setHits(result.results);
      setLastUpdated(Date.now());
      setStatus("loaded");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "OWID search failed.");
      setStatus("error");
    }
  }, []);

  const loadChart = useCallback(async (nextSlug: string, nextEntity: string | null) => {
    setStatus("loading");
    setError(null);
    try {
      const result = await fetchOwidChart(nextSlug, nextEntity);
      setPrint(result);
      setLastUpdated(Date.now());
      setStatus("loaded");
    } catch (caught) {
      setPrint(null);
      setError(caught instanceof Error ? caught.message : "OWID chart failed.");
      setStatus("error");
    }
  }, []);

  const load = useCallback(() => {
    if (slug) {
      void loadChart(slug, entity || null);
      return;
    }
    void loadSearch(query);
  }, [entity, loadChart, loadSearch, query, slug]);

  useEffect(() => {
    load();
  }, [load]);

  useAutoRefresh(status === "loaded" ? lastUpdated : null, load, 60);

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((token) => token + 1);
  }, []);
  const blurSearch = useCallback(() => setSearchFocused(false), []);

  const selectedHit = hits.find((hit) => hit.slug === selectedChartId) ?? hits[0] ?? null;
  const entityRows = print ? entityLatestRows(print) : [];
  const selectedEntity = entityRows.find((row) => row.code === (selectedEntityId || entity)) ?? entityRows[0] ?? null;
  const seriesPrint = print && entity
    ? {
      ...print,
      entity: print.entity ?? entityRows.find((row) => row.code === entity) ?? null,
      observations: print.observations.filter((row: OwidObservation) => row.code === entity),
    }
    : print;

  const chartColumns: ChartColumn[] = [
    { id: "title", label: "CHART", width: 0, align: "left", flexGrow: 1 },
    { id: "slug", label: "SLUG", width: Math.min(28, Math.max(12, Math.floor(width * 0.32))), align: "left" },
  ];
  const entityColumns: EntityColumn[] = [
    { id: "entity", label: "ENTITY", width: 0, align: "left", flexGrow: 1 },
    { id: "code", label: "CODE", width: 10, align: "left" },
    { id: "latest", label: "LATEST", width: 10, align: "right" },
  ];

  const sortedHits = sortStackItems(hits, chartSort, (left, right, columnId) => (
    columnId === "slug" ? left.slug.localeCompare(right.slug) : left.title.localeCompare(right.title)
  ));
  const sortedEntities = sortStackItems(entityRows, entitySort, (left, right, columnId) => {
    if (columnId === "code") return left.code.localeCompare(right.code);
    if (columnId === "latest") return (left.latest ?? -Infinity) - (right.latest ?? -Infinity);
    return left.name.localeCompare(right.name);
  });

  useEffect(() => {
    if (!slug && sortedHits.length > 0 && !sortedHits.some((hit) => hit.slug === selectedChartId)) {
      setSelectedChartId(sortedHits[0]!.slug);
    }
    if (slug && !entity && sortedEntities.length > 0 && !sortedEntities.some((row) => row.code === selectedEntityId)) {
      setSelectedEntityId(sortedEntities[0]!.code);
    }
  }, [entity, selectedChartId, selectedEntityId, slug, sortedEntities, sortedHits]);

  const openSelected = useCallback(() => {
    const url = seriesPrint?.url ?? selectedHit?.url;
    if (!url) return;
    openUrl(url);
  }, [selectedHit?.url, seriesPrint?.url]);

  const handleRootKeyDown = useCallback(
    (event: DataTableKeyEvent, context: DataTableRootKeyContext) => {
      if (context.selectedIndex <= 0 && isPlainArrowUp(event)) {
        stopSearchFocusNavigation(event);
        focusSearch();
        return true;
      }
      if (event.name === "s" || event.name === "/") {
        event.preventDefault?.();
        event.stopPropagation?.();
        focusSearch();
        return true;
      }
      if (isPlainKey(event, "r")) {
        event.preventDefault?.();
        event.stopPropagation?.();
        load();
        return true;
      }
      if (isPlainKey(event, "o")) {
        event.preventDefault?.();
        event.stopPropagation?.();
        openSelected();
        return true;
      }
      return false;
    },
    [focusSearch, load, openSelected],
  );

  useShortcut((event) => {
    if (!focused || searchFocused) return;
    if (event.name === "s" || event.name === "/") {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
    }
  }, { enabled: focused && !searchFocused });

  const detailOpen = Boolean(slug && entity && seriesPrint);
  usePaneFooter("owid", () => ({
    info: [
      ...(status === "loading" ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : []),
      ...(updatedAgo ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }] : []),
    ],
    hints: [
      { id: "search", key: "s", label: "earch", onPress: focusSearch },
      { id: "refresh", key: "r", label: "efresh", onPress: load },
      { id: "open", key: "o", label: "pen", onPress: openSelected, disabled: !(seriesPrint?.url || selectedHit?.url) },
    ],
  }), [error, focusSearch, load, openSelected, selectedHit?.url, seriesPrint?.url, status, updatedAgo]);

  if (status === "loading" && hits.length === 0 && !print) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label="Loading Our World in Data..." />
        </Box>
      </Box>
    );
  }

  if (error && hits.length === 0 && !print) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Box padding={1}>
          <EmptyState title="OWID unavailable." message={error} hint="Press r to retry." />
        </Box>
      </Box>
    );
  }

  const searchBar = (
    <InputSearchBar
      value={slug ? listFilter : query}
      focused={focused && !detailOpen}
      active={searchFocused}
      width={width}
      focusToken={searchFocusToken}
      inputRef={searchInputRef}
      placeholder={slug ? "filter entities" : "chart slug or topic"}
      debounceMs={250}
      onFocus={focusSearch}
      onBlur={blurSearch}
      onNavigateDown={blurSearch}
      onQueryChange={(value) => {
        if (slug) {
          setListFilter(value);
          return;
        }
        setQuery(value);
      }}
    />
  );

  if (slug && !entity) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <DataTableStackView
          focused={focused && !searchFocused}
          detailOpen={false}
          onBack={() => {
            setSlug("");
            setPrint(null);
          }}
          detailContent={null}
          rootBefore={searchBar}
          onRootKeyDown={handleRootKeyDown}
          selection={{
            kind: "id",
            selectedId: selectedEntityId,
            getId: (row) => row.code,
            onChange: setSelectedEntityId,
          }}
          onActivate={() => {
            if (!selectedEntity) return;
            setEntity(selectedEntity.code);
          }}
          rootWidth={width}
          rootHeight={height}
          columns={entityColumns}
          items={sortedEntities.filter((row) => {
            const needle = listFilter.trim().toLowerCase();
            if (!needle) return true;
            return row.name.toLowerCase().includes(needle) || row.code.toLowerCase().includes(needle);
          })}
          sortColumnId={entitySort.columnId}
          sortDirection={entitySort.direction}
          onHeaderClick={(columnId) => setEntitySort((current) => nextStackSortPreference(current, columnId as EntitySortId))}
          getItemKey={(row) => row.code}
          renderCell={(row, column, _index, state): DataTableCell => {
            const sel = state.selected ? colors.selectedText : undefined;
            if (column.id === "code") return { text: row.code, color: sel ?? colors.textDim };
            if (column.id === "latest") return { text: formatValue(row.latest), color: sel ?? colors.text };
            return { text: row.name, color: sel ?? colors.textBright, attributes: TextAttributes.BOLD };
          }}
          emptyStateTitle={error ?? "No entities."}
          emptyStateHint="Pick a grapher slug, then an ISO / OWID entity code."
        />
      </Box>
    );
  }

  if (detailOpen && seriesPrint) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <DataTableStackView<OwidObservation, SeriesColumn>
          focused={focused}
          detailOpen={true}
          onBack={() => setEntity("")}
          detailTitle={seriesPrint.entity?.name ?? seriesPrint.slug}
          detailContent={<OwidSeriesDetail print={seriesPrint} width={width} height={height} />}
          onRootKeyDown={handleRootKeyDown}
          selection={{ kind: "id", selectedId: seriesPrint.observations[0]?.time ?? null, getId: (row) => row.time, onChange: () => undefined }}
          onActivate={() => undefined}
          rootWidth={width}
          rootHeight={height}
          columns={[{ id: "time", label: "TIME", width: 10, align: "left" }, { id: "value", label: "VALUE", width: 0, align: "right", flexGrow: 1 }]}
          items={sortStackItems(seriesPrint.observations, seriesSort, (left, right, columnId) => (
            columnId === "value"
              ? (left.value ?? -Infinity) - (right.value ?? -Infinity)
              : left.time.localeCompare(right.time)
          ))}
          sortColumnId={seriesSort.columnId}
          sortDirection={seriesSort.direction}
          onHeaderClick={(columnId) => setSeriesSort((current) => nextStackSortPreference(current, columnId as SeriesSortId))}
          getItemKey={(row) => `${row.code}-${row.time}`}
          renderCell={(row, column, _index, state) => ({
            text: column.id === "time" ? row.time : formatValue(row.value),
            color: state.selected ? colors.selectedText : colors.text,
          })}
          emptyStateTitle="No observations."
          emptyStateHint="Press back to pick another entity."
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <DataTableStackView<OwidChartSearchHit, ChartColumn>
        focused={focused && !searchFocused}
        detailOpen={false}
        onBack={() => undefined}
        detailContent={null}
        rootBefore={searchBar}
        onRootKeyDown={handleRootKeyDown}
        selection={{
          kind: "id",
          selectedId: selectedChartId,
          getId: (row) => row.slug,
          onChange: setSelectedChartId,
        }}
        onActivate={() => {
          if (!selectedHit) return;
          blurSearch();
          setSlug(selectedHit.slug);
          setEntity("");
        }}
        rootWidth={width}
        rootHeight={height}
        columns={chartColumns}
        items={sortedHits}
        sortColumnId={chartSort.columnId}
        sortDirection={chartSort.direction}
        onHeaderClick={(columnId) => setChartSort((current) => nextStackSortPreference(current, columnId as ChartSortId))}
        getItemKey={(row) => row.slug}
        renderCell={(row, column, _index, state): DataTableCell => ({
          text: column.id === "slug" ? row.slug : row.title,
          color: state.selected ? colors.selectedText : column.id === "title" ? colors.textBright : colors.textDim,
          attributes: column.id === "title" ? TextAttributes.BOLD : undefined,
        })}
        emptyStateTitle="No OWID charts."
        emptyStateHint="Search a topic or enter a grapher slug."
      />
    </Box>
  );
}
