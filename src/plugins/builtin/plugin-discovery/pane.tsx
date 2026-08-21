import { useCallback, useMemo, useRef, useState } from "react";
import { Box, Text, TextAttributes, type InputRenderable } from "../../../ui";
import {
  DataTableStackView,
  EmptyState,
  InputSearchBar,
  Spinner,
  usePaneFooter,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
  type DataTableRootKeyContext,
} from "../../../components";
import { colors } from "../../../theme/colors";
import { openUrl } from "../../../components/ui/external-link";
import { usePluginAppActions } from "../../runtime";
import { isPlainKey } from "../../../utils/keyboard";
import { stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import { isPlainArrowUp } from "../../../utils/search-focus-navigation";
import type { PaneProps } from "../../../types/plugin";
import { searchPlugins } from "./client";
import type { LoadStatus, PluginSearchResult } from "./types";

interface PluginColumn extends DataTableColumn {
  id: "name" | "stars" | "description";
}

function createColumns(width: number): PluginColumn[] {
  const starsWidth = 7;
  const nameWidth = Math.min(30, Math.max(16, Math.floor(width * 0.3)));
  const descWidth = Math.max(20, width - starsWidth - nameWidth - 4);
  return [
    { id: "name", label: "PLUGIN", width: nameWidth, align: "left" },
    { id: "stars", label: "STARS", width: starsWidth, align: "right" },
    { id: "description", label: "DESCRIPTION", width: descWidth, align: "left" },
  ];
}

function renderPluginCell(
  row: PluginSearchResult,
  column: PluginColumn,
  _index: number,
  rowState: { selected: boolean },
): DataTableCell {
  const color = rowState.selected ? colors.selectedText : undefined;
  switch (column.id) {
    case "name":
      return { text: row.fullName, color: color ?? colors.textBright, attributes: TextAttributes.BOLD };
    case "stars":
      return { text: `★ ${row.stars}`, color: color ?? colors.textDim };
    case "description":
      return { text: row.description, color: color ?? colors.textMuted };
  }
}

function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const now = Date.now();
  const diff = now - date.getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return "today";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function PluginDiscoveryPane({ width, height, focused }: PaneProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PluginSearchResult[]>([]);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installStatus, setInstallStatus] = useState<string | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);
  const { notify } = usePluginAppActions();

  const columns = useMemo(() => createColumns(width), [width]);
  const selected = results.find((r) => String(r.id) === selectedId) ?? null;

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((c) => c + 1);
  }, []);

  const blurSearch = useCallback(() => {
    setSearchFocused(false);
  }, []);

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setStatus("idle");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const found = await searchPlugins(q);
      setResults(found);
      setSelectedId(found[0] ? String(found[0].id) : null);
      setStatus("loaded");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, []);

  const handleRefresh = useCallback(() => {
    void runSearch(query);
  }, [query, runSearch]);

  const handleOpen = useCallback(() => {
    if (selected) openUrl(selected.url);
  }, [selected]);

  const handleInstall = useCallback(async () => {
    if (!selected || installing) return;
    setInstalling(selected.fullName);
    setInstallStatus(null);
    try {
      const { join } = await import("path");
      const { existsSync, mkdirSync } = await import("fs");
      const { homedir } = await import("os");
      const pluginsDir = join(process.env.HOME || homedir(), ".gloomberb", "plugins");
      if (!existsSync(pluginsDir)) mkdirSync(pluginsDir, { recursive: true });
      const repoName = selected.fullName.split("/")[1]!;
      const targetDir = join(pluginsDir, repoName);

      if (existsSync(targetDir)) {
        setInstallStatus(`Already installed: ${repoName}`);
        notify({ body: `Plugin "${repoName}" is already installed`, type: "info" });
        setInstalling(null);
        return;
      }

      const proc = Bun.spawn(
        ["git", "clone", "--depth", "1", `https://github.com/${selected.fullName}.git`, targetDir],
        { stdout: "pipe", stderr: "pipe" },
      );
      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text();
        throw new Error(stderr.trim() || "git clone failed");
      }

      const pkgPath = join(targetDir, "package.json");
      if (existsSync(pkgPath)) {
        try {
          await Bun.spawn(["bun", "install"], { cwd: targetDir, stdout: "ignore", stderr: "ignore" }).exited;
        } catch { /* deps install is optional */ }
      }

      setInstallStatus(`Installed ${repoName} — restart to load`);
      notify({ body: `Installed ${repoName}`, type: "success" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setInstallStatus(`Install failed: ${msg}`);
      notify({ body: `Install failed: ${msg}`, type: "error" });
    } finally {
      setInstalling(null);
    }
  }, [selected, installing, notify]);

  usePaneFooter("plugin-discovery", () => ({
    info: [
      ...(status === "loading" ? [{ id: "loading", parts: [{ text: "Searching…", tone: "muted" as const }] }] : []),
      ...(status === "error" && error ? [{ id: "error", parts: [{ text: error, tone: "negative" as const }] }] : []),
      ...(installing ? [{ id: "installing", parts: [{ text: `Installing ${installing}…`, tone: "muted" as const }] }] : []),
      ...(installStatus ? [{ id: "install-status", parts: [{ text: installStatus, tone: installStatus.startsWith("Install failed") ? "negative" as const : "positive" as const }] }] : []),
    ],
    hints: [
      { id: "search", key: "/", label: "search", onPress: focusSearch },
      { id: "refresh", key: "r", label: "efresh", onPress: handleRefresh },
      ...(selected ? [{ id: "open", key: "o", label: "pen", onPress: handleOpen }] : []),
      ...(selected ? [{ id: "install", key: "i", label: "nstall", onPress: () => void handleInstall() }] : []),
    ],
  }), [status, error, installing, installStatus, focusSearch, handleRefresh, handleOpen, handleInstall, selected]);

  const handleRootKeyDown = useCallback((
    event: DataTableKeyEvent,
    context: DataTableRootKeyContext,
  ) => {
    if (context.selectedIndex <= 0 && isPlainArrowUp(event)) {
      stopSearchFocusNavigation(event);
      focusSearch();
      return true;
    }
    if (event.name === "o") {
      event.preventDefault?.();
      handleOpen();
      return true;
    }
    if (event.name === "i") {
      event.preventDefault?.();
      void handleInstall();
      return true;
    }
    if (event.name === "r") {
      event.preventDefault?.();
      handleRefresh();
      return true;
    }
    if (event.name === "/" || event.name === "s") {
      event.preventDefault?.();
      focusSearch();
      return true;
    }
    return false;
  }, [focusSearch, handleOpen, handleInstall, handleRefresh]);

  const searchBar = (
    <InputSearchBar
      value={query}
      focused={focused}
      active={searchFocused}
      width={width}
      focusToken={searchFocusToken}
      inputRef={searchInputRef}
      placeholder="plugin name or keyword…"
      debounceMs={120}
      onFocus={focusSearch}
      onBlur={blurSearch}
      onNavigateDown={blurSearch}
      onQueryChange={(q) => {
        setQuery(q);
        void runSearch(q);
      }}
    />
  );

  if (status === "loading" && results.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {searchBar}
        <Box height={1} />
        <Box flexDirection="row" height={height - 2} alignItems="center" justifyContent="center">
          <Spinner />
          <Text fg={colors.textDim}> Searching GitHub…</Text>
        </Box>
      </Box>
    );
  }

  if (status === "error" && results.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {searchBar}
        <Box height={1} />
        <Box padding={1}>
          <EmptyState title="Search failed" hint={error ?? "Press r to retry"} />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <DataTableStackView<PluginSearchResult, PluginColumn>
        focused={focused && !searchFocused}
        detailOpen={false}
        onBack={() => {}}
        detailContent={null}
        rootBefore={searchBar}
        onRootKeyDown={handleRootKeyDown}
        selection={{
          kind: "id",
          selectedId,
          getId: (row) => String(row.id),
          onChange: (id) => setSelectedId(id),
        }}
        onActivate={() => void handleInstall()}
        rootWidth={width}
        rootHeight={height}
        columns={columns}
        items={results}
        sortColumnId="stars"
        sortDirection="desc"
        onHeaderClick={() => {}}
        getItemKey={(row) => String(row.id)}
        renderCell={renderPluginCell}
        emptyStateTitle={query ? "No plugins found" : "Search for plugins"}
        emptyStateHint={query ? "Try a different keyword" : "Type above and press Enter"}
      />
      {selected && (
        <Box height={2} flexDirection="column">
          <Box height={1} flexDirection="row">
            <Text fg={colors.textDim}>  Updated </Text>
            <Text fg={colors.text}>{formatRelativeDate(selected.updatedAt)}</Text>
            <Text fg={colors.textDim}>   </Text>
            <Text fg={colors.textDim}>github.com/</Text>
            <Text fg={colors.textBright}>{selected.fullName}</Text>
          </Box>
          {installStatus && (
            <Box height={1}>
              <Text fg={installStatus.startsWith("Install failed") ? colors.negative : colors.positive}>
                {"  "}{installStatus}
              </Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
