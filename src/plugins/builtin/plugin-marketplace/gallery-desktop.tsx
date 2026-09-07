import {
  PaneSidebar,
  PaneSidebarRow,
} from "../../../components/layout/pane/sidebar";
import {
  MarketplaceActionRow,
  MarketplaceNote,
  MarketplaceSection,
  marketplaceSidebarWidth,
  useScrollMarketplaceRowIntoView,
} from "../../../components/marketplace/sidebar";
import { Button } from "../../../components/ui/button";
import { TextField } from "../../../components/ui/fields";
import { Spinner } from "../../../components/ui/loading";
import { t } from "../../../i18n";
import { useThemeColors } from "../../../theme/theme-context";
import { Box, ScrollBox, Text, TextAttributes } from "../../../ui";
import { formatCompact } from "../../../utils/format";
import type { DockLayoutNode, LayoutConfig, PaneInstanceConfig } from "../../../types/config";
import type { PaneDef } from "../../../types/plugin";
import { MiniWorkspace } from "../../../layout-marketplace/mini-workspace";
import { DetailRow } from "./detail-row";
import { isInstallable, type MarketplaceEntry } from "./model";
import { statusOf } from "./status";

const ELLIPSIS = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;
const ROW_ROLE = "plugin-gallery-row";

export interface PluginGalleryController {
  query: string;
  setQuery: (query: string) => void;
  installed: MarketplaceEntry[];
  discover: MarketplaceEntry[];
  selected: MarketplaceEntry | null;
  select: (id: string) => void;
  status: "loading" | "ready" | "error";
  catalogError: string | null;
  stale: boolean;
  refresh: (force: boolean) => void;
  install: (entry: MarketplaceEntry) => void;
  toggle: (entry: MarketplaceEntry) => void;
  installing: string | null;
  installError: string | null;
  installedNow: readonly string[];
  canInstall: boolean;
  canToggle: boolean;
  openSource: () => void;
  sourceUrl: string | null;
}

function EntryRow({
  entry,
  controller,
  selected,
}: {
  entry: MarketplaceEntry;
  controller: PluginGalleryController;
  selected: boolean;
}) {
  const colors = useThemeColors();
  const status = statusOf(entry, controller.installedNow);
  const select = () => controller.select(entry.id);
  const activate = () => {
    if (isInstallable(entry)) controller.install(entry);
    else if (entry.installed && entry.toggleable) controller.toggle(entry);
  };

  return (
    <PaneSidebarRow
      active={selected}
      ariaLabel={`${entry.name}, ${status.text}`}
      onSelect={select}
    >
      {({ foregroundColor, listWidth, onMouseDown }) => (
        <Box
          width={listWidth}
          height={1}
          minWidth={0}
          flexDirection="row"
          alignItems="center"
          role="button"
          tabIndex={0}
          aria-label={`${entry.name}, ${status.text}`}
          aria-current={selected ? "true" : undefined}
          data-gloom-id={entry.id}
          data-gloom-role={ROW_ROLE}
          data-gloom-interactive="true"
          onMouseOver={select}
          onFocus={select}
          onMouseDown={onMouseDown}
          onKeyDown={(event: { key?: string; preventDefault?: () => void; stopPropagation?: () => void }) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault?.();
            event.stopPropagation?.();
            activate();
          }}
          style={{ cursor: "pointer" }}
        >
          <Text fg={entry.featured ? colors.borderFocused : foregroundColor} selectable={false}>
            {entry.featured ? " ● " : "   "}
          </Text>
          <Text
            fg={foregroundColor}
            attributes={entry.featured || entry.enabled ? TextAttributes.BOLD : 0}
            selectable={false}
            style={{ ...ELLIPSIS, minWidth: 0, flexShrink: 1 }}
          >
            {entry.name}
          </Text>
          <Text> </Text>
        </Box>
      )}
    </PaneSidebarRow>
  );
}

function DiscoverStatus({ controller }: { controller: PluginGalleryController }) {
  const colors = useThemeColors();
  if (controller.status === "loading") {
    return (
      <Box flexDirection="row" alignItems="center" paddingX={1} flexShrink={0}>
        <Spinner />
        <Text fg={colors.textDim}>{` ${t("Loading…")}`}</Text>
      </Box>
    );
  }
  if (controller.status === "error") {
    return (
      <>
        <MarketplaceNote>
          <Text fg={colors.negative} wrapText>
            {controller.catalogError
              ? `${t("Plugin catalog unavailable.")} ${controller.catalogError}`
              : t("Plugin catalog unavailable.")}
          </Text>
        </MarketplaceNote>
        <MarketplaceActionRow label={t("Retry")} onPress={() => controller.refresh(true)} rowRole={ROW_ROLE} />
      </>
    );
  }
  if (controller.stale && controller.catalogError) {
    return (
      <>
        <MarketplaceNote>
          <Text fg={colors.warning} wrapText>
            {`Showing cached plugin catalog. ${controller.catalogError}`}
          </Text>
        </MarketplaceNote>
        <MarketplaceActionRow label={t("Refresh")} onPress={() => controller.refresh(true)} rowRole={ROW_ROLE} />
      </>
    );
  }
  if (controller.discover.length === 0) {
    return (
      <MarketplaceNote>
        {controller.query.trim()
          ? t("No plugins match this search.")
          : t("No community plugins listed yet.")}
      </MarketplaceNote>
    );
  }
  return null;
}

function PreviewEmpty({ controller }: { controller: PluginGalleryController }) {
  const colors = useThemeColors();
  const searching = controller.query.trim().length > 0;
  return (
    <Box
      flexGrow={1}
      alignItems="center"
      justifyContent="center"
      data-gloom-role="plugin-gallery-preview-empty"
      padding={2}
    >
      <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
        {searching ? t("No plugins match this search.") : t("No plugin selected.")}
      </Text>
    </Box>
  );
}

function splitPreviewDock(instanceIds: readonly string[]): DockLayoutNode | null {
  if (instanceIds.length === 0) return null;
  let node: DockLayoutNode = { kind: "pane", instanceId: instanceIds[0]! };
  for (const instanceId of instanceIds.slice(1)) {
    node = {
      kind: "split",
      axis: "horizontal",
      ratio: 0.52,
      first: node,
      second: { kind: "pane", instanceId },
    };
  }
  return node;
}

/** `hacker-news` → `Hacker News`, so preview tiles read like pane titles. */
function humanizeId(value: string): string {
  return value
    .split(/[-_./:]/g)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const MAX_PREVIEW_PANES = 4;

function buildPluginPreview(entry: MarketplaceEntry): {
  layout: LayoutConfig;
  panes: ReadonlyMap<string, PaneDef>;
} {
  const contributed = entry.contributes?.panes ?? [];
  // A plugin with no panes still gets one tile so the preview is never blank.
  const previewIds = contributed.length > 0 ? contributed.slice(0, MAX_PREVIEW_PANES) : [entry.id];
  const instances: PaneInstanceConfig[] = previewIds.map((paneId, index) => ({
    instanceId: `plugin-preview:${entry.id}:${index}`,
    paneId,
    binding: { kind: "none" },
  }));
  const icon = entry.name.trim().charAt(0).toUpperCase();
  const panes = new Map<string, PaneDef>(
    previewIds.map((paneId) => [
      paneId,
      {
        id: paneId,
        name: humanizeId(paneId),
        icon,
        component: () => null,
        defaultPosition: "left",
      },
    ]),
  );
  return {
    layout: {
      dockRoot: splitPreviewDock(instances.map((instance) => instance.instanceId)),
      instances,
      floating: [],
      detached: [],
    },
    panes,
  };
}

function PluginPreview({ entry }: { entry: MarketplaceEntry }) {
  const preview = buildPluginPreview(entry);
  return (
    <Box
      flexGrow={1}
      minWidth={0}
      minHeight={8}
      padding={1}
      overflow="hidden"
      data-gloom-role="plugin-gallery-preview-image"
    >
      <MiniWorkspace
        layout={preview.layout}
        panes={preview.panes}
        width={640}
        height={260}
        detail
      />
    </Box>
  );
}

function PreviewPane({
  controller,
  entry,
}: {
  controller: PluginGalleryController;
  entry: MarketplaceEntry;
}) {
  const colors = useThemeColors();
  const status = statusOf(entry, controller.installedNow);
  const contributes: string[] = [];
  if (entry.contributes) {
    const { panes, capabilities, broker } = entry.contributes;
    if (panes.length > 0) contributes.push(`${panes.length} pane${panes.length === 1 ? "" : "s"}`);
    if (capabilities.length > 0) {
      contributes.push(`${capabilities.length} data source${capabilities.length === 1 ? "" : "s"}`);
    }
    if (broker) contributes.push("a broker integration");
  }
  const metadata = [
    entry.tier,
    entry.categories.join(", "),
    entry.installedVersion ? `v${entry.installedVersion}` : null,
    !entry.bundled && entry.stars > 0 ? `${formatCompact(entry.stars)} stars` : null,
  ].filter(Boolean).join(" · ");
  const installing = controller.installing === entry.id;
  const installable = controller.canInstall && isInstallable(entry);
  const toggleable = controller.canToggle && entry.installed && entry.toggleable;
  const primaryLabel = installing
    ? "Installing…"
    : installable
      ? "Install Plugin"
      : toggleable
        ? (entry.enabled ? "Disable" : "Enable")
        : null;

  return (
    <Box flexDirection="column" flexGrow={1} minWidth={0} minHeight={0} data-gloom-role="plugin-gallery-preview">
      <Box
        height={3}
        flexDirection="column"
        justifyContent="center"
        paddingX={1}
        flexShrink={0}
        style={{ borderBottom: `1px solid ${colors.border}` }}
      >
        <Box height={1} flexDirection="row" alignItems="center" minWidth={0}>
          <Text
            fg={colors.textBright}
            attributes={TextAttributes.BOLD}
            style={{ ...ELLIPSIS, minWidth: 0, flexShrink: 1 }}
          >
            {entry.name}
          </Text>
          <Text fg={status.color}>{`  ${status.text.toUpperCase()}`}</Text>
          <Box flexGrow={1} minWidth={0} />
          <Button label="Refresh Catalog" variant="secondary" onPress={() => controller.refresh(true)} />
        </Box>
        <Text fg={colors.textMuted} style={ELLIPSIS}>{metadata}</Text>
      </Box>

      <ScrollBox flexGrow={1} minWidth={0} minHeight={8} padding={1} scrollY>
        <PluginPreview entry={entry} />
        {entry.tagline ? (
          <Box paddingBottom={1}>
            <Text fg={colors.text} wrapText style={{ minWidth: 0 }}>{entry.tagline}</Text>
          </Box>
        ) : null}
        {entry.description ? (
          <Box paddingBottom={1} flexDirection="column">
            <Text fg={colors.textDim} wrapText style={{ minWidth: 0 }}>{entry.description}</Text>
          </Box>
        ) : null}
        {!entry.installed && !entry.bundled && entry.repo ? (
          <Box paddingBottom={1}>
            <Text fg={colors.textDim} wrapText>
              {t("Runs with your full permissions. Read the source first.")}
            </Text>
          </Box>
        ) : null}
        {contributes.length > 0 ? <DetailRow label="Adds" value={contributes.join(", ")} /> : null}
        {entry.hosts.length > 0 ? <DetailRow label="Declares" value={entry.hosts.join(", ")} /> : null}
        {entry.repo ? <DetailRow label="Source" value={`github.com/${entry.repo}`} /> : null}
        {entry.loadError ? <DetailRow label="Error" value={entry.loadError} /> : null}
        {controller.installError ? <DetailRow label="Install" value={controller.installError} /> : null}
      </ScrollBox>

      <Box
        height={2}
        flexDirection="row"
        alignItems="center"
        paddingX={1}
        flexShrink={0}
        style={{ borderTop: `1px solid ${colors.border}` }}
      >
        {primaryLabel ? (
          <Button
            label={primaryLabel}
            variant="primary"
            disabled={installing}
            onPress={() => (installable ? controller.install(entry) : controller.toggle(entry))}
          />
        ) : null}
        {controller.sourceUrl ? (
          <>
            {primaryLabel ? <Box width={1} /> : null}
            <Button label="Open Source" variant="secondary" onPress={controller.openSource} />
          </>
        ) : null}
        <Box flexGrow={1} minWidth={0} />
        {installable ? (
          <Text fg={colors.textMuted} style={{ ...ELLIPSIS, minWidth: 0 }}>
            {t("Loads after restart")}
          </Text>
        ) : isInstallable(entry) && entry.repo ? (
          <Text fg={colors.textMuted} style={{ ...ELLIPSIS, minWidth: 0 }}>
            {`gloomberb install ${entry.repo}`}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}

export function PluginGalleryDesktop({
  controller,
  focused = true,
  width = 118,
  height = 34,
}: {
  controller: PluginGalleryController;
  focused?: boolean;
  width?: number;
  height?: number;
}) {
  const sidebarWidth = marketplaceSidebarWidth(width);
  const selected = controller.selected;
  useScrollMarketplaceRowIntoView(ROW_ROLE, selected?.id);

  return (
    <Box
      width={width}
      height={height}
      flexDirection="row"
      overflow="hidden"
      data-gloom-role="plugin-gallery"
    >
      <PaneSidebar width={sidebarWidth} height={height} focused={focused} keyboardFocused={focused}>
        {({ listWidth }) => (
          <>
            <Box height={2} paddingX={1} justifyContent="center" flexShrink={0}>
              <TextField
                value={controller.query}
                placeholder={t("Search plugins")}
                onChange={controller.setQuery}
                width={Math.max(1, listWidth - 2)}
              />
            </Box>
            <ScrollBox
              scrollY
              flexGrow={1}
              minHeight={0}
              focusable={false}
              data-gloom-role="plugin-gallery-sidebar"
            >
              <MarketplaceSection title="Installed" count={controller.installed.length} />
              {controller.installed.length === 0 ? (
                <MarketplaceNote>
                  {controller.query.trim()
                    ? t("No installed plugins match this search.")
                    : t("No plugins installed yet.")}
                </MarketplaceNote>
              ) : controller.installed.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  controller={controller}
                  selected={entry.id === selected?.id}
                />
              ))}

              <MarketplaceSection title="Discover" count={controller.discover.length} />
              <DiscoverStatus controller={controller} />
              {controller.discover.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  controller={controller}
                  selected={entry.id === selected?.id}
                />
              ))}
            </ScrollBox>
          </>
        )}
      </PaneSidebar>

      <Box flexDirection="column" flexGrow={1} minWidth={0} minHeight={0}>
        {selected
          ? <PreviewPane controller={controller} entry={selected} />
          : <PreviewEmpty controller={controller} />}
      </Box>
    </Box>
  );
}
