import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, ScrollBox, type ScrollBoxRenderable } from "../../../ui";
import { useRendererHost } from "../../../ui/host";
import {
  Button,
  DataTableStackView,
  DataTableView,
  PaneListChrome,
  PaneStatusBody,
  SelectButton,
  TextField,
  openUrl,
  usePaneListSearch,
  usePaneNoticeFooter,
  useTableLoadMore,
  type DataTableColumn,
  type DataTableVisibleRange,
  type PaneHint,
} from "../../../components";
import {
  useAsyncResource,
  useAutoRefresh,
  usePaneSettingValue,
  usePluginAppActions,
  usePluginPaneState,
  usePluginTickerActions,
  useShortcut,
} from "../../../public/react";
import { useDialog } from "../../../ui/dialog";
import { useThemeColors } from "../../../theme/theme-context";
import { priceColor } from "../../../theme/colors";
import {
  NUMERIC_FIELDS,
  type NumericField,
  type ScreenDefinition,
  type ScreenField,
  type ScreenRow,
  type SavedScreen,
} from "../../../api-client/equity-screener";
import type { PaneProps } from "../../../types/plugin";
import { buildScreenerQuoteTargets } from "../shared/screener-live-quotes";
import { useLiveStreamingSetting } from "../shared/live-streaming";
import { usePaneStatusFooter } from "../shared/pane-footer";
import { SignInWall } from "../cloud/auth-actions";
import { useLiveQuoteEntries } from "../../../state/hooks/quote-streaming";
import { PageStackView } from "../../../components/ui";
import { getTableWidth } from "../../../components/ui/table-layout";
import { CriterionEditor } from "./criterion-editor";
import {
  fetchSavedScreens,
  fetchScreenFields,
  screenerApi,
  validateSavedScreen,
} from "./client";
import {
  columnWidth,
  criterionText,
  DEFAULT_SCREEN,
  formatScreenValue,
  metricDate,
  parseScreenDefinition,
  resultFields,
  SHORT_LABELS,
  SIGN_COLORED,
  screenLabel,
  screenRowId,
} from "./model";
import { useScreenResults } from "./results";
import { overlayLiveScreenRows } from "./live";
import { useEquityScreenerSession } from "./session";
import { chooseOption, confirmDelete, KeyValueRow, Notice } from "./widgets";

const TABS = [
  { value: "results", label: "Results" },
  { value: "criteria", label: "Criteria" },
  { value: "saved", label: "Saved" },
];
/** A list this long is worth a filter. Shorter lists stay a plain table. */
const SEARCH_MIN_ROWS = 8;
const TABLE_STREAM_OVERSCAN = 8;
const INITIAL_STREAM_RANGE: DataTableVisibleRange = { start: 0, end: 40 };

function streamWindowRows<T>(rows: readonly T[], range: DataTableVisibleRange, selected: T | undefined): T[] {
  const window = rows.slice(
    Math.max(0, range.start - TABLE_STREAM_OVERSCAN),
    range.end + TABLE_STREAM_OVERSCAN,
  );
  return selected && !window.includes(selected) ? [...window, selected] : window;
}

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Request failed.";
const date = (value: string | null) => value?.slice(0, 10) ?? "--";
const rank = (value: number | null) => value == null ? "--" : value.toFixed(0);
const percentileText = (value: number | null | undefined) => {
  const shown = value == null || !Number.isFinite(value) ? "--" : value.toFixed(0);
  return `${shown} pctl`;
};

function resultColumns(
  width: number,
  definition: ScreenDefinition,
  metric: NumericField,
  asOf: boolean,
): DataTableColumn[] {
  const [focus, ...others] = resultFields(definition, metric);
  const metricColumn = (field: NumericField): DataTableColumn => ({
    id: `m:${field}`,
    label: SHORT_LABELS[field],
    width: columnWidth(field),
    align: "right",
  });
  const build = (extra: DataTableColumn[], exchange: boolean, sector: boolean): DataTableColumn[] => [
    { id: "symbol", label: "SYMBOL", width: 8, align: "left" },
    { id: "name", label: "NAME", width: 18, flexGrow: 1, align: "left" },
    ...(exchange ? [{ id: "exchange", label: "EXCH", width: 7, align: "left" as const }] : []),
    ...(sector ? [{ id: "sector", label: "SECTOR", width: 22, align: "left" as const }] : []),
    metricColumn(focus!),
    { id: "percentile", label: "PCTL", width: 4, align: "right" },
    ...(asOf ? [{ id: "date", label: "AS OF", width: 10, align: "left" as const }] : []),
    ...extra,
  ];
  const fits = (columns: DataTableColumn[]) => getTableWidth(columns) <= width;
  let shown: DataTableColumn[] = [];
  for (const field of others) {
    const next = [...shown, metricColumn(field)];
    if (!fits(build(next, false, false))) break;
    shown = next;
  }
  const exchange = fits(build(shown, true, false));
  const sector = exchange && fits(build(shown, true, true));
  return build(shown, exchange, sector);
}

function matchesQuery(parts: Array<string | null | undefined>, query: string): boolean {
  if (!query) return true;
  return parts.filter(Boolean).join(" ").toLowerCase().includes(query);
}

type ColumnSort = { id: string; direction: "asc" | "desc" };

function toggleColumnSort(current: ColumnSort | null, id: string): ColumnSort {
  if (current?.id === id) {
    return { id, direction: current.direction === "desc" ? "asc" : "desc" };
  }
  return { id, direction: "asc" };
}

function compareText(left: string, right: string, direction: "asc" | "desc"): number {
  const result = left.localeCompare(right);
  return direction === "asc" ? result : -result;
}

function ScreenDetail({
  row,
  width,
  height,
  onResearch,
}: {
  row: ScreenRow;
  width: number;
  height: number;
  onResearch: () => void;
}) {
  return (
    <ScrollBox width={width} height={height} scrollY>
      <Box paddingX={1} flexDirection="column">
        <Button label="Research" variant="secondary" onPress={onResearch} />
        <KeyValueRow
          label="Listing"
          value={`${row.symbol}:${row.exchange}`}
          detail={[row.currency, row.sector, row.industry].filter(Boolean).join(" · ") || "--"}
        />
        {NUMERIC_FIELDS.map((field) => {
          const metric = row.metrics[field];
          const stamp = metricDate(metric);
          return (
            <KeyValueRow
              key={field}
              label={screenLabel(field)}
              value={`${formatScreenValue(field, metric.value)} ${metric.unit}`}
              detail={
                metric.value === null
                  ? (metric.reason ?? "unavailable")
                  : [
                      percentileText(metric.percentile.value),
                      stamp.collected ? `collected ${stamp.text}` : stamp.text,
                      metric.state === "available" ? null : metric.state,
                    ].filter(Boolean).join(" · ")
              }
            />
          );
        })}
      </Box>
    </ScrollBox>
  );
}

export function EquityScreenerPane(props: PaneProps) {
  const session = useEquityScreenerSession();
  const [seed] = usePaneSettingValue<string | undefined>("definition", undefined);
  let initial: ScreenDefinition;
  try {
    initial = seed ? parseScreenDefinition(JSON.parse(seed)) : DEFAULT_SCREEN;
  } catch (error) {
    return (
      <PaneStatusBody subject="screen definition" error={errorText(error)} />
    );
  }
  return (
    <EquityScreenView
      key={`${seed ?? "default"}:${session.requestKey}`}
      {...props}
      initial={initial}
    />
  );
}

function EquityScreenView({
  width,
  height,
  focused,
  initial,
}: PaneProps & { initial: ScreenDefinition }) {
  const colors = useThemeColors();
  const dialog = useDialog();
  const host = useRendererHost();
  const { notify } = usePluginAppActions();
  const { navigateTicker } = usePluginTickerActions();
  const session = useEquityScreenerSession();
  const access = session.access;
  const [definition, setDefinition] = usePluginPaneState("definition", initial);
  const [metric, setMetric] = usePaneSettingValue<NumericField>("metric", "marketCap");
  const [mode, setMode] = usePluginPaneState("mode", "results");
  const [selectedId, setSelectedId] = usePluginPaneState<string | null>("selected", null);
  const [openId, setOpenId] = usePluginPaneState<string | null>("open", null);
  const [selectedCriterion, setSelectedCriterion] = usePluginPaneState("criterion", "0");
  const [editing, setEditing] = useState<number | null>(null);
  const [savedSelectedId, setSavedSelectedId] = usePluginPaneState<string | null>("savedSelected", null);
  const [currentSavedId, setCurrentSavedId] = usePluginPaneState<string | null>("currentSaved", null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saveFocus, setSaveFocus] = useState("name");
  const [saveForm, setSaveForm] = useState(false);
  const [name, setName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [criteriaSort, setCriteriaSort] = useState<ColumnSort | null>(null);
  const [savedSort, setSavedSort] = useState<ColumnSort | null>(null);
  // The resource refetches when the loader identity changes. An inline function
  // is new every render, so the design-gate mount never settles.
  const loadFields = useCallback(
    (_force: boolean, signal: AbortSignal) => fetchScreenFields(signal),
    [],
  );
  const fields = useAsyncResource(loadFields);
  const savedLoader = useCallback(() => fetchSavedScreens(), [session.requestKey]);
  const saved = useAsyncResource(
    access.emailVerified && (mode === "saved" || saveForm) ? savedLoader : null,
  );
  const results = useScreenResults(definition, session.requestKey);
  const data = results.data;
  const snapshotRows = data?.rows ?? [];
  const liveStreaming = useLiveStreamingSetting();
  const [visibleRange, setVisibleRange] = useState<DataTableVisibleRange>(INITIAL_STREAM_RANGE);
  const listLength = mode === "saved"
    ? (saved.data?.length ?? 0)
    : mode === "criteria"
      ? definition.criteria.length
      : snapshotRows.length;
  const searchEnabled = listLength >= SEARCH_MIN_ROWS && !saveForm && editing === null;
  const listSearch = usePaneListSearch({
    focused: focused && searchEnabled,
    enabled: searchEnabled,
    value: searchQuery,
    onQueryChange: setSearchQuery,
    placeholder: mode === "saved" ? "screen name" : mode === "criteria" ? "criterion" : "symbol or name",
  });
  useEffect(() => {
    if (!searchEnabled && searchQuery) setSearchQuery("");
  }, [searchEnabled, searchQuery]);
  const query = searchEnabled ? searchQuery.trim().toLowerCase() : "";
  const filteredSnapshot = useMemo(
    () => snapshotRows.filter((row) => matchesQuery([row.symbol, row.name, row.exchange, row.sector, row.industry], query)),
    [query, snapshotRows],
  );
  const streamTargets = useMemo(() => {
    const selectedRow = filteredSnapshot.find((row) => screenRowId(row) === selectedId);
    return buildScreenerQuoteTargets(
      streamWindowRows(filteredSnapshot, visibleRange, selectedRow),
      selectedRow?.symbol ?? null,
    );
  }, [filteredSnapshot, selectedId, visibleRange]);
  const { entries: liveEntries } = useLiveQuoteEntries(streamTargets, {
    freshnessScopeKey: `equity-screener:${JSON.stringify(definition)}`,
    liveStreaming,
  });
  const rows = useMemo(
    () => overlayLiveScreenRows(filteredSnapshot, liveEntries),
    [filteredSnapshot, liveEntries],
  );
  const opened = rows.find((row) => screenRowId(row) === openId)
    ?? snapshotRows.find((row) => screenRowId(row) === openId);
  const selected = opened ?? rows.find((row) => screenRowId(row) === selectedId) ?? rows[0];
  const currentSaved = saved.data?.find((row) => row.id === currentSavedId);
  const criteriaItems = useMemo(() => {
    const items = definition.criteria.map((criterion, index) => ({
      id: String(index),
      criterion,
      text: criterionText(criterion),
    }));
    if (!criteriaSort) return items;
    return [...items].sort((left, right) => compareText(left.text, right.text, criteriaSort.direction));
  }, [criteriaSort, definition.criteria]);
  const savedItems = useMemo(() => {
    const items = (saved.data ?? []).filter((row) => matchesQuery(
      [row.name, ...row.definition.criteria.map(criterionText)],
      mode === "saved" ? query : "",
    ));
    if (!savedSort) return items;
    return [...items].sort((left, right) => {
      const value = savedSort.id === "updatedAt"
        ? left.updatedAt
        : savedSort.id === "criteria"
          ? left.definition.criteria.map(criterionText).join("; ")
          : left.name;
      const other = savedSort.id === "updatedAt"
        ? right.updatedAt
        : savedSort.id === "criteria"
          ? right.definition.criteria.map(criterionText).join("; ")
          : right.name;
      return compareText(value, other, savedSort.direction);
    });
  }, [mode, query, saved.data, savedSort]);
  const selectedSaved = savedItems.find((row) => row.id === savedSelectedId) ?? savedItems[0];
  useEffect(() => {
    if (
      openId &&
      data &&
      !data.rows.some((row) => screenRowId(row) === openId) &&
      data.nextCursor &&
      !results.loading &&
      !results.loadingMore
    )
      void results.loadMore();
  }, [openId, data, results.loading, results.loadingMore, results.loadMore]);
  const tableScroll = useRef<ScrollBoxRenderable | null>(null);
  const loadMore = useTableLoadMore(
    tableScroll,
    mode === "results" && !opened && !results.loading && !results.loadingMore && !!data?.nextCursor,
    results.loadMore,
  );
  const metricFields = fields.data?.fields.filter((field) => field.kind === "number") ?? [];
  const staleFocus = snapshotRows.some((row) => row.metrics[metric]?.state === "stale");
  const columns = resultColumns(width, definition, metric, staleFocus);
  const apply = (next: ScreenDefinition) => {
    try {
      setDefinition(parseScreenDefinition(next));
      setOpenId(null);
      setActionError(null);
    } catch (error) {
      setActionError(errorText(error));
    }
  };
  const switchMode = (next: string) => {
    setMode(next);
    setEditing(null);
    setSaveForm(false);
    setActionError(null);
  };
  const research = () => {
    if (selected) navigateTicker(selected.symbol);
  };
  const startSave = () => {
    if (!access.emailVerified) {
      switchMode("saved");
      return;
    }
    setName(currentSaved?.name ?? "");
    setSaveForm(true);
    setSaveFocus("name");
    setActionError(null);
  };
  const save = async (copy = false) => {
    if (saving || !name.trim()) return;
    setSaving(true);
    setActionError(null);
    const requestSession = session.requestKey;
    try {
      const entry = validateSavedScreen(
        currentSaved && !copy
          ? await screenerApi.update(currentSaved.id, currentSaved.revision, name.trim(), definition)
          : await screenerApi.create(name.trim(), definition),
      );
      if (requestSession !== session.requestKey) return;
      setCurrentSavedId(entry.id);
      setSavedSelectedId(entry.id);
      setSaveForm(false);
      setMode("saved");
      await saved.reload();
      notify({ body: `Saved ${entry.name}`, type: "success" });
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setSaving(false);
    }
  };
  const removeSaved = async () => {
    const entry = selectedSaved;
    if (!entry || saving) return;
    const confirmed = await confirmDelete(dialog, entry.name);
    if (!confirmed) return;
    setSaving(true);
    try {
      await screenerApi.remove(entry.id, entry.revision);
      await saved.reload();
      if (currentSavedId === entry.id) setCurrentSavedId(null);
      notify({ body: "Screen deleted", type: "success" });
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setSaving(false);
    }
  };
  const exportAll = async () => {
    if (!data?.snapshot || exporting) return;
    setExporting(true);
    setActionError(null);
    try {
      if (!host.saveTextFile) throw new Error("File export is unavailable in this renderer.");
      const file = await screenerApi.export(data.definition, data.snapshot.id);
      if (file.snapshotId !== data.snapshot.id || typeof file.csv !== "string")
        throw new Error("Export snapshot did not match the displayed screen.");
      const location = await host.saveTextFile({
        name: file.filename,
        text: file.csv,
        mimeType: "text/csv",
      });
      notify({ body: `Exported ${location}`, type: "success" });
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setExporting(false);
    }
  };
  useAutoRefresh(results.updatedAt, results.load);
  const chooseMetric = () => {
    const options = metricFields.length
      ? metricFields.map((field) => ({ value: field.id, label: field.label }))
      : [{ value: metric, label: screenLabel(metric) }];
    void chooseOption(dialog, "Metric", metric, options).then((value) => {
      if (!value || !(NUMERIC_FIELDS as readonly string[]).includes(value)) return;
      const next = value as NumericField;
      setMetric(next);
      apply({ ...definition, sort: { field: next, direction: "desc" } });
    });
  };
  const chooseCurrency = () => {
    const options = [
      { value: "all", label: "All currencies" },
      ...[...new Set([definition.currency ?? "USD", "USD", "EUR", "GBP", "JPY", ...(data?.universe.currencies ?? [])])]
        .map((value) => ({ value, label: value })),
    ];
    void chooseOption(dialog, "Currency", definition.currency ?? "all", options).then((value) => {
      if (!value) return;
      apply({ ...definition, currency: value === "all" ? null : value });
    });
  };
  const sourceUrl = selected?.metrics[metric]?.sourceUrl ?? null;
  const hints = useMemo<PaneHint[]>(() => {
    if (saveForm || editing !== null) return [];
    if (mode === "criteria") {
      return [
        { id: "add", key: "a", label: "dd criterion", onPress: () => setEditing(-1), disabled: !fields.data || definition.criteria.length >= 20 },
        ...(fields.data ? [{ id: "currency", key: "c", label: "urrency", onPress: chooseCurrency }] : []),
        {
          id: "remove",
          key: "d",
          label: "elete criterion",
          onPress: () => apply({
            ...definition,
            criteria: definition.criteria.filter((_, index) => index !== Number(selectedCriterion)),
          }),
          disabled: !definition.criteria.length,
        },
      ];
    }
    if (mode === "saved") {
      return [
        {
          id: "delete",
          key: "d",
          label: "elete",
          onPress: () => { void removeSaved(); },
          disabled: !selectedSaved || saving,
        },
        ...(searchEnabled ? [{ id: "search", key: "s", label: "earch", onPress: listSearch.focusSearch, disabled: listSearch.searchFocused }] : []),
      ];
    }
    return [
      ...(data && !opened ? [{ id: "metric", key: "m", label: "etric", onPress: chooseMetric }] : []),
      ...(searchEnabled
        ? [{ id: "search", key: "s", label: "earch", onPress: listSearch.focusSearch, disabled: listSearch.searchFocused }]
        : [{ id: "save", key: "s", label: "ave screen", onPress: startSave }]),
      { id: "export", key: "e", label: "xport", onPress: () => { void exportAll(); }, disabled: !data?.snapshot || exporting },
      ...(sourceUrl ? [{ id: "open", key: "o", label: "pen", onPress: () => openUrl(sourceUrl) }] : []),
    ];
  }, [
    chooseCurrency,
    chooseMetric,
    data,
    definition,
    editing,
    exporting,
    fields.data,
    listSearch.focusSearch,
    listSearch.searchFocused,
    mode,
    opened,
    saveForm,
    saving,
    searchEnabled,
    selectedCriterion,
    selectedSaved,
    sourceUrl,
    startSave,
  ]);
  const footerError = results.error
    ?? (mode === "criteria" ? fields.error : null)
    ?? (mode === "saved" ? saved.error : null);
  const loading = results.loading || results.loadingMore
    || (mode === "criteria" && fields.loading && !fields.data)
    || (mode === "saved" && saved.loading && !saved.data)
    || saving
    || exporting;
  usePaneStatusFooter({
    registrationId: "equity-screener",
    focused,
    loading,
    error: footerError,
    info: staleFocus ? [{ id: "stale", parts: [{ text: "stale", tone: "warning" }] }] : [],
    hints,
  });
  usePaneNoticeFooter({
    registrationId: "equity-screener:notices",
    focused,
    notices: [...(data?.warnings ?? []), ...(opened?.warnings ?? [])],
  });
  useShortcut((event) => {
    if (!focused || listSearch.searchFocused || event.targetEditable) return;
    if (event.name !== "r" || event.ctrl || event.meta || event.shift || event.alt) return;
    event.preventDefault();
    void results.load();
    if (mode === "saved") void saved.reload();
  }, { enabled: focused && !listSearch.searchFocused && !saveForm && editing === null });
  useShortcut(
    (event) => {
      if (!saveForm) return;
      const ring = ["name", "save", ...(currentSaved ? ["copy"] : []), "cancel"];
      if (event.name === "tab") {
        event.preventDefault();
        event.stopPropagation();
        setSaveFocus((current) => ring[(ring.indexOf(current) + (event.shift ? -1 : 1) + ring.length) % ring.length]!);
      } else if (event.name === "escape") {
        event.preventDefault();
        event.stopPropagation();
        setSaveForm(false);
      } else if (["enter", "return"].includes(event.name ?? "") && !event.targetEditable) {
        event.preventDefault();
        event.stopPropagation();
        if (saveFocus === "cancel") setSaveForm(false);
        else void save(saveFocus === "copy");
      }
    },
    { enabled: focused && saveForm, allowEditable: true, phase: "before", scope: "equity-screen-save" },
  );
  const chromeRows = 1 + (searchEnabled ? 1 : 0);
  const showMetric = mode === "results" && !opened;
  const showCurrency = mode === "criteria" && editing === null;
  const filterRow = showMetric || showCurrency ? 1 : 0;
  const tableHeight = Math.max(5, height - chromeRows - filterRow);
  const saveContent = !access.emailVerified ? (
    <SignInWall action="save and open your screens" needsVerification={session.needsVerification} />
  ) : (
    <Box paddingX={1} paddingTop={1} flexDirection="column" gap={1}>
      <TextField
        label="Screen name"
        value={name}
        onChange={setName}
        onSubmit={() => { void save(); }}
        focused={focused && saveFocus === "name"}
        onMouseDown={() => setSaveFocus("name")}
        width={Math.min(45, width - 4)}
      />
      {actionError ? <Notice tone="negative">{actionError}</Notice> : null}
      <Box flexDirection="row" gap={1}>
        <Button label={currentSaved ? "Update screen" : "Save screen"} variant="primary" active={focused && saveFocus === "save"} disabled={saving || !name.trim()} onPress={() => { void save(); }} />
        {currentSaved ? (
          <Button label="Save copy" variant="secondary" active={focused && saveFocus === "copy"} disabled={saving || !name.trim()} onPress={() => { void save(true); }} />
        ) : null}
        <Button label="Cancel" variant="secondary" active={focused && saveFocus === "cancel"} onPress={() => setSaveForm(false)} />
      </Box>
    </Box>
  );
  const editingCriterion = editing !== null && editing >= 0 ? definition.criteria[editing] : undefined;
  const currencyOptions = [
    { value: "all", label: "All currencies" },
    ...[...new Set([definition.currency ?? "USD", "USD", "EUR", "GBP", "JPY", ...(data?.universe.currencies ?? [])])]
      .map((value) => ({ value, label: value })),
  ];
  const metricOptions = metricFields.length
    ? metricFields.map((field) => ({ value: field.id as NumericField, label: field.label }))
    : [{ value: metric, label: screenLabel(metric) }];
  const body = mode === "criteria" ? (
    <PaneStatusBody loading={fields.loading && !fields.data} error={!fields.data ? fields.error : null} subject="screen fields">
      {fields.data ? (
        <PageStackView
          focused={focused && !saveForm}
          detailOpen={editing !== null}
          onBack={() => setEditing(null)}
          detailTitle={editingCriterion ? criterionText(editingCriterion) : "New criterion"}
          detailContent={editing !== null ? (
            <CriterionEditor
              key={editing}
              fields={fields.data.fields}
              value={editingCriterion ?? null}
              focused={focused}
              width={width}
              onCancel={() => setEditing(null)}
              onSave={(criterion) => {
                const criteria = [...definition.criteria];
                if (editing < 0) criteria.push(criterion);
                else criteria[editing] = criterion;
                apply({ ...definition, criteria });
                setEditing(null);
              }}
            />
          ) : null}
          rootContent={(
            <>
              {showCurrency ? (
                <Box height={1} paddingX={1}>
                  <SelectButton
                    label="Currency"
                    value={definition.currency ?? "all"}
                    options={currencyOptions}
                    onChange={(value) => apply({ ...definition, currency: value === "all" ? null : value })}
                  />
                </Box>
              ) : null}
              <DataTableView
                columns={[{ id: "criterion", label: "CRITERION", width: 20, flexGrow: 1, align: "left" }]}
                items={criteriaItems}
                focused={focused && editing === null && !saveForm && !listSearch.searchFocused}
                rootWidth={width}
                rootHeight={tableHeight}
                getItemKey={(row) => row.id}
                selection={{
                  kind: "id",
                  selectedId: selectedCriterion,
                  getId: (row) => row.id,
                  onChange: setSelectedCriterion,
                }}
                onActivate={(row) => setEditing(Number(row.id))}
                onRootKeyDown={(event) => listSearch.handleSearchKey(event)}
                renderCell={(row) => ({ text: row.text })}
                sortColumnId={criteriaSort?.id ?? null}
                sortDirection={criteriaSort?.direction ?? "asc"}
                onHeaderClick={(id) => setCriteriaSort((current) => toggleColumnSort(current, id))}
                emptyStateTitle="No criteria. All covered equities match."
              />
            </>
          )}
        />
      ) : null}
    </PaneStatusBody>
  ) : mode === "saved" ? (
    !access.emailVerified ? (
      <SignInWall action="save and open your screens" needsVerification={session.needsVerification} />
    ) : (
      <PaneStatusBody loading={saved.loading && !saved.data} error={!saved.data ? saved.error : null} subject="saved screens">
        <DataTableView
          columns={[
            { id: "name", label: "SCREEN", width: 28, align: "left" },
            { id: "criteria", label: "CRITERIA", width: 20, flexGrow: 1, align: "left" },
            { id: "updatedAt", label: "UPDATED", width: 11, align: "left" },
          ]}
          items={savedItems}
          focused={focused && !saveForm && !listSearch.searchFocused}
          rootWidth={width}
          rootHeight={tableHeight}
          getItemKey={(row) => row.id}
          selection={{
            kind: "id",
            selectedId: selectedSaved?.id ?? null,
            getId: (row) => row.id,
            onChange: setSavedSelectedId,
          }}
          onActivate={(row: SavedScreen) => {
            apply(row.definition);
            setCurrentSavedId(row.id);
            setMode("results");
          }}
          onRootKeyDown={(event) => listSearch.handleSearchKey(event)}
          renderCell={(row, column) => ({
            text: column.id === "name"
              ? row.name
              : column.id === "updatedAt"
                ? date(row.updatedAt)
                : row.definition.criteria.map(criterionText).join("; "),
          })}
          sortColumnId={savedSort?.id ?? null}
          sortDirection={savedSort?.direction ?? "asc"}
          onHeaderClick={(id) => setSavedSort((current) => toggleColumnSort(current, id))}
          emptyStateTitle={query ? "No saved screens match this search." : "No saved screens."}
        />
      </PaneStatusBody>
    )
  ) : (
    <PaneStatusBody loading={results.loading && !data} error={!data ? results.error : null} subject="equity screen">
      {showMetric ? (
        <Box height={1} flexDirection="row" gap={2} paddingX={1}>
          <SelectButton
            label="Metric"
            value={metric}
            options={metricOptions}
            onChange={(value) => {
              if (!(NUMERIC_FIELDS as readonly string[]).includes(value)) return;
              const next = value as NumericField;
              setMetric(next);
              apply({ ...definition, sort: { field: next, direction: "desc" } });
            }}
          />
          <Button label="Save" variant="secondary" onPress={startSave} />
        </Box>
      ) : null}
      <DataTableStackView
        columns={columns}
        items={rows}
        focused={focused && !saveForm && !listSearch.searchFocused}
        rootWidth={width}
        rootHeight={tableHeight}
        scrollRef={tableScroll}
        onBodyScrollActivity={loadMore}
        resetScrollKey={JSON.stringify(definition)}
        visibleRangeKey={JSON.stringify(definition)}
        onVisibleRangeChange={setVisibleRange}
        onRootKeyDown={(event) => listSearch.handleSearchKey(event)}
        getItemKey={screenRowId}
        selection={{
          kind: "id",
          selectedId: rows.some((row) => screenRowId(row) === selectedId)
            ? selectedId
            : (rows[0] ? screenRowId(rows[0]) : null),
          getId: screenRowId,
          onChange: setSelectedId,
        }}
        onActivate={(row) => setOpenId(screenRowId(row))}
        detailOpen={!!opened}
        onBack={() => setOpenId(null)}
        detailTitle={opened?.name ?? opened?.symbol}
        detailContent={opened ? (
          <ScreenDetail row={opened} width={width} height={tableHeight} onResearch={() => navigateTicker(opened.symbol)} />
        ) : null}
        renderCell={(row, column) => {
          const field = column.id.startsWith("m:") ? column.id.slice(2) as NumericField : null;
          if (field) {
            const observation = row.metrics[field];
            const change = SIGN_COLORED.has(field) && observation.value != null
              ? priceColor(Math.abs(observation.value) < 0.05 ? 0 : observation.value, colors)
              : undefined;
            return {
              text: formatScreenValue(field, observation.value),
              color: observation.state === "stale" ? colors.warning : change,
            };
          }
          const focus = row.metrics[metric];
          if (column.id === "percentile") return { text: rank(focus.percentile.value) };
          if (column.id === "date") {
            return focus.state === "stale"
              ? { text: metricDate(focus).text, color: colors.warning }
              : { text: "" };
          }
          if (column.id === "name") return { text: row.name ?? "--" };
          return { text: String(row[column.id as "symbol"] ?? "--") };
        }}
        sortColumnId={(NUMERIC_FIELDS as readonly string[]).includes(definition.sort.field)
          ? `m:${definition.sort.field}`
          : definition.sort.field}
        sortDirection={definition.sort.direction}
        onHeaderClick={(id) => {
          const field = id.startsWith("m:")
            ? id.slice(2) as NumericField
            : id === "percentile" || id === "date"
              ? metric
              : ["symbol", "sector", "exchange"].includes(id)
                ? id as ScreenField
                : null;
          if (!field) return;
          if ((NUMERIC_FIELDS as readonly string[]).includes(field)) setMetric(field as NumericField);
          apply({
            ...definition,
            sort: {
              field,
              direction: definition.sort.field === field && definition.sort.direction === "desc" ? "asc" : "desc",
            },
          });
        }}
        emptyStateTitle={query ? "No equities match this search." : "No equities match this screen."}
      />
    </PaneStatusBody>
  );
  return (
    <Box width={width} height={height} flexDirection="column">
      <PageStackView
        focused={focused}
        detailOpen={saveForm}
        onBack={() => setSaveForm(false)}
        detailTitle="Save screen"
        rootContent={(
          <PaneListChrome
            width={width}
            height={height}
            focused={focused && !saveForm && editing === null}
            tabs={TABS}
            activeValue={mode}
            onSelect={switchMode}
            search={searchEnabled ? listSearch.search : null}
          >
            {body}
          </PaneListChrome>
        )}
        detailContent={saveForm ? saveContent : null}
      />
    </Box>
  );
}
