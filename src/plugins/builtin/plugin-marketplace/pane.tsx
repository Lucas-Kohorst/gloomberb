import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DataTableStackView,
  ConfirmDialog,
  InputSearchBar,
  Spinner,
  type DataTableCell,
  type DataTableColumn,
  type PaneFooterSegment,
} from "../../../components";
import { useMarketplaceListNavigation } from "../../../components/marketplace/sidebar";
import { colors } from "../../../theme/colors";
import type { PaneProps } from "../../../types/plugin";
import { Box, ScrollBox, Text, TextAttributes, useRendererHost, useUiHost, type InputRenderable } from "../../../ui";
import { useDialog, type PromptContext } from "../../../ui/dialog";
import { formatCompact } from "../../../utils/format";
import { formatRelativeAge } from "../../../utils/relative-time";
import {
  applySortPreference,
  CLEARED_SORT,
  nextSortPreference,
  type SortPreference,
} from "../../../utils/sort-values";
import { paneRefreshHint, paneSearchHint, usePaneStatusLinkFooter } from "../shared/pane-footer";
import { getCurrentPluginTarget } from "../../current-target";
import { loadRegistry, registryPluginUrl } from "./feed";
import { PluginGalleryDesktop, type PluginGalleryController } from "./gallery-desktop";
import {
  filterEntries,
  mergeCatalog,
  sortEntries,
  isInstallable,
  type MarketplaceEntry,
  type RegistryPlugin,
} from "./model";
import { DetailRow } from "./detail-row";
import { getMarketplaceHost, getPluginInstaller, getPluginRemover } from "./store";
import { statusOf } from "./status";

export const PLUGIN_MARKETPLACE_PANE_ID = "plugin-marketplace";

type ColumnId = "name" | "tagline" | "stars" | "status";
type Column = DataTableColumn & { id: ColumnId };

function buildColumns(): Column[] {
  return [
    { id: "name", label: "PLUGIN", width: 14, align: "left" },
    { id: "tagline", label: "DESCRIPTION", width: 16, align: "left", flexGrow: 1 },
    { id: "stars", label: "STARS", width: 6, align: "right" },
    { id: "status", label: "STATUS", width: 14, align: "left" },
  ];
}

const COLUMNS = buildColumns();

function renderCell(
  entry: MarketplaceEntry,
  column: Column,
  rowState: { selected: boolean },
  installedNow: readonly string[],
): DataTableCell {
  const selected = rowState.selected ? colors.selectedText : undefined;

  switch (column.id) {
    case "name":
      return {
        text: entry.name,
        color: selected ?? (entry.featured ? colors.textBright : colors.text),
        ...(entry.featured ? { attributes: TextAttributes.BOLD } : {}),
      };
    case "tagline":
      return { text: entry.tagline, color: selected ?? colors.textDim };
    case "stars":
      return {
        text: entry.bundled || entry.stars === 0 ? "—" : formatCompact(entry.stars),
        color: selected ?? colors.textDim,
      };
    case "status": {
      const status = statusOf(entry, installedNow);
      return { text: status.text, color: rowState.selected ? colors.selectedText : status.color };
    }
  }
}

function EntryDetail({ entry, width }: { entry: MarketplaceEntry; width: number }) {
  const contributes: string[] = [];
  if (entry.contributes) {
    const { panes, capabilities, broker } = entry.contributes;
    if (panes.length > 0) contributes.push(`${panes.length} pane${panes.length === 1 ? "" : "s"}`);
    if (capabilities.length > 0) contributes.push(`${capabilities.length} data source${capabilities.length === 1 ? "" : "s"}`);
    if (broker) contributes.push("a broker integration");
  }

  return (
    <ScrollBox flexDirection="column" width={width} paddingLeft={1} paddingRight={1}>
      <Text fg={colors.textDim} wrapText style={{ minWidth: 0 }}>
        {[
          entry.tier,
          entry.categories.join(", "),
          entry.installedVersion ? `v${entry.installedVersion}` : null,
          !entry.bundled && entry.stars > 0 ? `${entry.stars} stars` : null,
        ].filter(Boolean).join(" — ")}
      </Text>

      {entry.description ? (
        <Box paddingTop={1} flexDirection="column">
          <Text fg={colors.text} wrapText style={{ minWidth: 0 }}>{entry.description}</Text>
        </Box>
      ) : null}

      <Box paddingTop={1} flexDirection="column">
        {contributes.length > 0 ? <DetailRow label="Adds" value={contributes.join(", ")} /> : null}
        {/*
          * Declared by the plugin author and not enforced: plugins are not
          * sandboxed, so this is a hint about intent, not a limit. Labelled
          * "Declares" rather than "Network" so it does not read as a guarantee.
          */}
        {entry.hosts.length > 0 ? <DetailRow label="Declares" value={entry.hosts.join(", ")} /> : null}
        {entry.repo ? <DetailRow label="Source" value={`github.com/${entry.repo}`} /> : null}
        {entry.loadError ? <DetailRow label="Error" value={entry.loadError} /> : null}
      </Box>

      {!entry.installed && !entry.bundled && entry.repo ? (
        <Box paddingTop={1} flexDirection="column">
          <Text fg={colors.textDim} wrapText style={{ minWidth: 0 }}>
            Runs with your full permissions. Read the source first.
          </Text>
          <Text fg={colors.textBright} wrapText style={{ minWidth: 0 }}>{`gloomberb install ${entry.repo}`}</Text>
        </Box>
      ) : null}
    </ScrollBox>
  );
}

export function PluginMarketplacePane({ focused, width, height }: PaneProps) {
  const ui = useUiHost();
  const dialog = useDialog();
  const renderer = useRendererHost();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  // Cleared sort keeps the curated order: featured first, then tier, then stars.
  const [sortPreference, setSortPreference] = useState<SortPreference<ColumnId>>(CLEARED_SORT);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);

  const [registry, setRegistry] = useState<RegistryPlugin[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  // Bumped after a toggle or install so the list is re-read from the host.
  const [localRevision, setLocalRevision] = useState(0);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  // Installed during this session. A plugin is only registered at startup, so
  // saying "enabled" here would be a lie — the pane it adds is not there yet.
  const [installedNow, setInstalledNow] = useState<readonly string[]>([]);

  const refresh = useCallback((force: boolean) => {
    setStatus((current) => (current === "ready" ? current : "loading"));
    void loadRegistry({ force }).then((result) => {
      setRegistry(result.plugins);
      setStale(result.stale);
      setFetchedAt(result.fetchedAt);
      setCatalogError(result.error);
      setStatus(result.error && result.plugins.length === 0 ? "error" : "ready");
    });
  }, []);

  useEffect(() => refresh(false), [refresh]);

  const target = getCurrentPluginTarget();
  const entries = useMemo(() => {
    void localRevision;
    const installed = getMarketplaceHost()?.listInstalled() ?? [];
    return sortEntries(mergeCatalog({ registry, installed, target }));
  }, [registry, target, localRevision]);

  const rows = useMemo(() => {
    const filtered = filterEntries(entries, { query, category: null });
    return applySortPreference(filtered, sortPreference, (entry, columnId) => {
      switch (columnId) {
        case "name":
          return entry.name;
        case "tagline":
          return entry.tagline;
        case "stars":
          return entry.stars;
        case "status":
          return statusOf(entry, installedNow).text;
      }
    });
  }, [entries, installedNow, query, sortPreference]);

  const selected = useMemo(
    () => rows.find((entry) => entry.id === selectedId) ?? rows[0] ?? null,
    [rows, selectedId],
  );
  const installed = useMemo(() => rows.filter((entry) => entry.installed === true), [rows]);
  const discover = useMemo(() => rows.filter((entry) => entry.installed === false), [rows]);

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((token) => token + 1);
  }, []);
  const blurSearch = useCallback(() => setSearchFocused(false), []);

  const toggle = useCallback((entry: MarketplaceEntry) => {
    const host = getMarketplaceHost();
    if (!host || !entry.installed || !entry.toggleable) return;
    host.setPluginEnabled(entry.id, !entry.enabled);
    setLocalRevision((value) => value + 1);
  }, []);

  const install = useCallback((entry: MarketplaceEntry) => {
    const installPlugin = getPluginInstaller();
    if (!isInstallable(entry) || !installPlugin || installing) return;
    if (installedNow.includes(entry.id)) return;
    // Installs address the repository, not the plugin id: there is no central
    // name resolution, so owner/repo is the only unambiguous reference.
    const repo = entry.repo;
    if (!repo) return;
    const target = entry.id;
    setInstalling(target);
    setInstallError(null);
    void installPlugin(repo).then((result) => {
      setInstalling(null);
      if (result.ok) {
        setInstalledNow((current) => [...current, target]);
        setLocalRevision((value) => value + 1);
        return;
      }
      setInstallError(result.error ?? "Install failed.");
    });
  }, [installedNow, installing]);

  const toggleSelected = useCallback(() => {
    if (selected) toggle(selected);
  }, [selected, toggle]);

  const installSelected = useCallback(() => {
    if (selected) install(selected);
  }, [install, selected]);
  const removeSelected = useCallback(async () => {
    const remover = getPluginRemover();
    if (!selected || selected.bundled || !selected.installed || !remover) return;
    const confirmed = await dialog.prompt<boolean>({
      closeOnClickOutside: true,
      content: (context: PromptContext<boolean>) => (
        <ConfirmDialog
          {...context}
          title="Uninstall plugin?"
          body={`Remove "${selected.name}" from disk?`}
          confirmLabel="Uninstall"
          cancelLabel="Cancel"
        />
      ),
    }).catch(() => false);
    if (!confirmed) return;
    const result = await remover(selected.id);
    if (result.ok) setLocalRevision((value) => value + 1);
    else setInstallError(result.error ?? "Uninstall failed.");
  }, [dialog, selected]);

  const sourceUrl = selected ? registryPluginUrl(selected.id) : null;
  const openSource = useCallback(() => {
    if (!sourceUrl) return;
    void renderer.openExternal(sourceUrl);
  }, [renderer, sourceUrl]);
  const canInstall = !!selected && isInstallable(selected) && !installedNow.includes(selected.id) && !!getPluginInstaller();
  const canToggle = !!selected && selected.installed && selected.toggleable;
  const canRemove = !!selected && selected.installed && !selected.bundled && !!getPluginRemover();
  const isDesktop = ui.kind === "desktop-web";

  // The terminal table owns its own cursor; only the desktop sidebar needs this.
  // Items follow the sidebar's rendered order, not the table's sort order.
  const sidebarItems = useMemo(() => [...installed, ...discover], [discover, installed]);
  useMarketplaceListNavigation({
    enabled: isDesktop && focused,
    scope: "plugin-gallery",
    items: sidebarItems,
    selectedId: selected?.id ?? null,
    select: setSelectedId,
  });

  const info: PaneFooterSegment[] = [];
  if (status === "loading") info.push({ id: "loading", parts: [{ text: "loading", tone: "muted" }] });
  if (status === "error") info.push({ id: "error", parts: [{ text: "catalog unavailable", tone: "warning" }] });
  if (stale) info.push({ id: "stale", parts: [{ text: "stale catalog", tone: "warning" }] });
  if (installing) {
    info.push({ id: "installing", parts: [{ text: `installing ${installing}`, tone: "muted" }] });
  }
  if (installError) info.push({ id: "install-error", parts: [{ text: installError, tone: "warning" }] });
  if (installedNow.length > 0 && !installing) {
    info.push({ id: "restart", parts: [{ text: "restart to load new plugins", tone: "warning" }] });
  }
  if (status === "ready" && fetchedAt && !stale) {
    info.push({ id: "updated", parts: [{ text: formatRelativeAge(fetchedAt), tone: "muted" }] });
  }

  usePaneStatusLinkFooter({
    registrationId: PLUGIN_MARKETPLACE_PANE_ID,
    focused,
    url: sourceUrl,
    source: selected ? "gloom.sh" : null,
    showOpenHint: true,
    info,
    hints: [
      paneSearchHint(focusSearch),
      paneRefreshHint(() => refresh(true)),
      ...(canInstall
        ? [{ id: "install", key: "i", label: "nstall", onPress: installSelected }]
        : canToggle
          ? [{ id: "toggle", key: "e", label: selected?.enabled ? "disable" : "nable", onPress: toggleSelected }]
          : []),
      ...(canRemove ? [{ id: "remove", key: "x", label: "uninstall", onPress: () => void removeSelected() }] : []),
    ],
  });

  const controller: PluginGalleryController = {
    query,
    setQuery,
    installed,
    discover,
    selected,
    select: (id) => setSelectedId(id),
    status,
    catalogError,
    stale,
    refresh,
    install,
    toggle,
    installing,
    installError,
    installedNow,
    canInstall,
    canToggle,
    canRemove,
    openSource,
    sourceUrl,
    remove: removeSelected,
  };

  if (isDesktop) {
    return (
      <PluginGalleryDesktop
        controller={controller}
        focused={focused}
        width={width}
        height={height}
      />
    );
  }

  if (status === "loading" && entries.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height} backgroundColor={colors.bg}>
        <Box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column">
          <Spinner />
          <Text fg={colors.textDim}>Loading plugin catalog…</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <DataTableStackView<MarketplaceEntry, Column>
        focused={focused && !searchFocused}
        detailOpen={detailOpen && !!selected}
        onBack={() => setDetailOpen(false)}
        detailContent={selected ? <EntryDetail entry={selected} width={width} /> : null}
        detailTitle={selected?.name}
        rootBefore={(
          <InputSearchBar
            value={query}
            focused={focused && !detailOpen}
            active={searchFocused}
            width={width}
            focusToken={searchFocusToken}
            inputRef={searchInputRef}
            placeholder="name or category"
            debounceMs={80}
            onFocus={focusSearch}
            onBlur={blurSearch}
            onNavigateDown={blurSearch}
            onQueryChange={setQuery}
          />
        )}
        selection={{
          kind: "id",
          selectedId: selected?.id ?? null,
          getId: (entry) => entry.id,
          onChange: (id) => setSelectedId(typeof id === "string" ? id : null),
        }}
        onActivate={() => setDetailOpen(true)}
        rootWidth={width}
        rootHeight={height}
        columns={COLUMNS}
        items={rows}
        getItemKey={(entry) => entry.id}
        sortColumnId={sortPreference.columnId}
        sortDirection={sortPreference.direction}
        onHeaderClick={(columnId) => {
          setSortPreference((current) => nextSortPreference(current, columnId as ColumnId, {
            defaultDirection: (id) => (id === "stars" ? "desc" : "asc"),
            resetTo: CLEARED_SORT,
          }));
        }}
        renderCell={(entry, column, _index, rowState) => renderCell(entry, column, rowState, installedNow)}
        emptyStateTitle={status === "error" ? "Plugin catalog unavailable." : "No plugins match."}
        emptyStateHint={status === "error"
          ? `${catalogError ?? "The catalog could not be loaded."} Press r to retry.`
          : undefined}
      />
    </Box>
  );
}
