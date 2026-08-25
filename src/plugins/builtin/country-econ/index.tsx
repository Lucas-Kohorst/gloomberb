import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, TextAttributes, type InputRenderable } from "../../../ui";
import {
  DataTableView,
  EmptyState,
  InputSearchBar,
  Spinner,
  Tabs,
  type DataTableCell,
  type DataTableKeyEvent,
  type DataTableRootKeyContext,
  type PaneFooterSegment,
} from "../../../components";
import { useShortcut } from "../../../react/input";
import { colors } from "../../../theme/colors";
import { formatCompact } from "../../../utils/format";
import { isPlainKey } from "../../../utils/keyboard";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import { openUrl } from "../../../components/ui/external-link";
import type { PaneProps } from "../../../types/plugin";
import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import {
  paneRefreshHint,
  paneSearchHint,
  usePaneStatusLinkFooter,
} from "../shared/pane-footer";
import { loadCountryEcon } from "./client";
import { COUNTRY_ECON_INDICATORS, DEFAULT_INDICATOR_ID } from "./indicators";
import {
  buildCountryEconColumns,
  DEFAULT_COUNTRY_ECON_SORT,
  nextCountryEconSort,
  nextKindFilter,
  sortCountryEconRows,
  visibleCountryEconRows,
  type CountryEconColumn,
  type CountryEconSort,
  type KindFilter,
} from "./model";
import { matchesCountryEconSearch } from "./normalize";
import {
  COUNTRY_ECON_PANE_ID,
  COUNTRY_ECON_PLUGIN_ID,
  WORLD_BANK_CONNECTION_ID,
  type CountryEconRow,
  type LoadStatus,
} from "./types";

function formatValue(row: CountryEconRow): string {
  if (row.value == null) return "—";
  if (row.unit === "%") return `${row.value.toFixed(1)}%`;
  if (row.unit === "people" || row.unit.includes("US$")) return formatCompact(row.value);
  return formatCompact(row.value);
}

function renderCell(
  row: CountryEconRow,
  column: CountryEconColumn,
  selected: boolean,
): DataTableCell {
  const selectedColor = selected ? colors.selectedText : undefined;
  switch (column.id) {
    case "iso3":
      return { text: row.iso3, color: selectedColor ?? colors.textBright, attributes: TextAttributes.BOLD };
    case "name":
      return { text: row.name, color: selectedColor ?? colors.text };
    case "kind":
      return { text: row.kind, color: selectedColor ?? colors.textMuted };
    case "year":
      return { text: row.year || "—", color: selectedColor ?? colors.textDim };
    case "value":
      return {
        text: formatValue(row),
        color: selectedColor ?? (row.value == null ? colors.textDim : colors.text),
      };
  }
}

function CountryEconPane({ paneId, focused, width, height }: PaneProps) {
  const [indicatorId, setIndicatorId] = useState(DEFAULT_INDICATOR_ID);
  const [rows, setRows] = useState<CountryEconRow[]>([]);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<KindFilter>("all");
  const [sort, setSort] = useState<CountryEconSort>(DEFAULT_COUNTRY_ECON_SORT);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const searchInputRef = useRef<InputRenderable | null>(null);
  const fetchGen = useRef(0);

  const load = useCallback(async () => {
    fetchGen.current += 1;
    const gen = fetchGen.current;
    setStatus("loading");
    setError(null);
    try {
      const next = await loadCountryEcon(indicatorId);
      if (fetchGen.current !== gen) return;
      setRows(next);
      setStatus("loaded");
      setLastUpdated(Date.now());
    } catch (err) {
      if (fetchGen.current !== gen) return;
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, [indicatorId]);

  useEffect(() => {
    void load();
  }, [load]);
  useAutoRefresh(lastUpdated, load);

  const visible = useMemo(() => {
    const filtered = visibleCountryEconRows(rows, kind).filter((row) => (
      matchesCountryEconSearch(row, searchQuery)
    ));
    return sortCountryEconRows(filtered, sort);
  }, [kind, rows, searchQuery, sort]);

  useEffect(() => {
    if (!selectedId || !visible.some((row) => row.id === selectedId)) {
      setSelectedId(visible[0]?.id ?? null);
    }
  }, [selectedId, visible]);

  const selected = visible.find((row) => row.id === selectedId) ?? null;
  const indicator = COUNTRY_ECON_INDICATORS.find((entry) => entry.id === indicatorId)
    ?? COUNTRY_ECON_INDICATORS[0]!;
  const selectedUrl = selected
    ? `https://data.worldbank.org/indicator/${indicator.wbCode}?locations=${selected.iso3}`
    : null;

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((current) => current + 1);
  }, []);

  const handleRootKeyDown = useCallback((
    event: DataTableKeyEvent,
    context: DataTableRootKeyContext,
  ) => {
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
    if (isPlainKey(event, "f")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      setKind((current) => nextKindFilter(current));
      return true;
    }
    return false;
  }, [focusSearch]);

  const footerInfo = useMemo<PaneFooterSegment[]>(() => [
    ...(kind !== "all" ? [{ id: "kind", parts: [{ text: kind, tone: "muted" as const }] }] : []),
    ...(rows.length > 0 ? [{ id: "delayed", parts: [{ text: "delayed", tone: "muted" as const }] }] : []),
  ], [kind, rows.length]);

  usePaneStatusLinkFooter({
    registrationId: paneId,
    focused,
    url: selectedUrl,
    source: "World Bank",
    label: "series",
    loading: status === "loading",
    error,
    info: footerInfo,
    showOpenHint: !!selectedUrl,
    hints: [
      paneSearchHint(focusSearch),
      paneRefreshHint(load, { disabled: status === "loading" && rows.length === 0 }),
      {
        id: "filter",
        key: "f",
        label: "ilter",
        onPress: () => setKind((current) => nextKindFilter(current)),
      },
    ],
  });

  useShortcut((event) => {
    if (!focused || searchFocused) return;
    if (event.name === "s" || event.name === "/") {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
    }
  }, { enabled: focused && !searchFocused });

  const columns = useMemo(() => buildCountryEconColumns(width), [width]);
  const tabs = (
    <Box height={1}>
      <Tabs
        tabs={COUNTRY_ECON_INDICATORS.map((entry) => ({ label: entry.label, value: entry.id }))}
        activeValue={indicatorId}
        onSelect={setIndicatorId}
        compact
        variant="bare"
        focused={focused && !searchFocused}
      />
    </Box>
  );

  if (status === "loading" && rows.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label="Loading World Bank series..." />
        </Box>
      </Box>
    );
  }

  if (error && rows.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height} padding={1}>
        {tabs}
        <EmptyState title="World Bank unavailable." />
      </Box>
    );
  }

  return (
    <DataTableView<CountryEconRow, CountryEconColumn>
      focused={focused && !searchFocused}
      rootWidth={width}
      rootHeight={height}
      rootBefore={(
        <Box flexDirection="column">
          {tabs}
          <InputSearchBar
            value={searchQuery}
            focused={focused}
            active={searchFocused}
            width={width}
            focusToken={searchFocusToken}
            inputRef={searchInputRef}
            placeholder="USA, euro, region"
            debounceMs={80}
            onFocus={focusSearch}
            onBlur={() => setSearchFocused(false)}
            onNavigateDown={() => setSearchFocused(false)}
            onQueryChange={setSearchQuery}
          />
        </Box>
      )}
      selection={{
        kind: "id",
        selectedId,
        getId: (row) => row.id,
        onChange: setSelectedId,
      }}
      onActivate={(row) => {
        openUrl(`https://data.worldbank.org/indicator/${indicator.wbCode}?locations=${row.iso3}`);
      }}
      columns={columns}
      items={visible}
      sortColumnId={sort.columnId}
      sortDirection={sort.direction}
      onHeaderClick={(columnId) => {
        setSort((current) => nextCountryEconSort(current, columnId as CountryEconColumn["id"]));
      }}
      getItemKey={(row) => row.id}
      renderCell={(row, column, _index, state) => renderCell(row, column, state.selected)}
      emptyStateTitle="No matching economies."
      onRootKeyDown={handleRootKeyDown}
    />
  );
}

let disposeWorldBankConnection: (() => void) | null = null;

export const countryEconModule: PluginModule = {
  panes: [
    {
      id: COUNTRY_ECON_PANE_ID,
      name: "Country Economics",
      icon: "E",
      component: CountryEconPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 88, height: 30 },
    },
  ],
  paneTemplates: [
    {
      id: "country-econ-pane",
      paneId: COUNTRY_ECON_PANE_ID,
      label: "Country Economics",
      description:
        "Country and regional GDP, inflation, unemployment, and population from the World Bank. Complements Our World in Data with official aggregates.",
      keywords: [
        "world bank",
        "gdp",
        "cpi",
        "inflation",
        "unemployment",
        "population",
        "country",
        "regional",
        "macro",
        "economics",
      ],
      category: "Data",
      shortcut: { prefix: "WB" },
      createInstance: () => ({ placement: "floating" }),
    },
  ],
  setup() {
    disposeWorldBankConnection = registerConnectionSource({
      id: WORLD_BANK_CONNECTION_ID,
      name: "World Bank",
      kind: "api",
      pluginId: COUNTRY_ECON_PLUGIN_ID,
      authRequired: false,
      priority: 340,
    });
  },
  dispose() {
    disposeWorldBankConnection?.();
    disposeWorldBankConnection = null;
  },
};
