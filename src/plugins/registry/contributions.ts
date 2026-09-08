import type { BrokerAdapter } from "../../types/broker";
import type {
  AlertConditionDef,
  CommandBarSearchProvider,
  ChartSeriesCatalogProvider,
  DocumentSearchProvider,
  CommandDef,
  ContextMenuProviderDef,
  CustomColumnDef,
  KeyboardShortcut,
  PaneDef,
  PaneTemplateDef,
  TickerAction,
  TickerResearchTabDef,
} from "../../types/plugin";
import { dropQueuedAgentPromptFragment, dropQueuedAgentTool } from "../builtin/ai/runner";
import { normalizeRegisteredPane, type LoosePaneDef } from "../runtime/normalize-pane";

export interface ContextMenuProviderEntry {
  pluginId: string;
  provider: ContextMenuProviderDef;
}

export interface PluginItems {
  panes: string[];
  paneTemplates: string[];
  commands: string[];
  commandBarSearchProviders: string[];
  documentSearchProviders: string[];
  chartSeriesCatalogs: string[];
  alertConditions: string[];
  columns: string[];
  brokers: string[];
  capabilities: string[];
  tickerResearchTabs: string[];
  shortcuts: string[];
  tickerActions: string[];
  contextMenuProviders: string[];
  agentTools: string[];
  agentPromptFragments: string[];
  eventDisposers: Array<() => void>;
  capabilityDisposers: Array<() => void>;
  newsQueryWatchDisposers: Array<() => void>;
}

interface RegistryContributionsOptions {
  wrapPaneDef: (pluginId: string, pane: PaneDef) => PaneDef;
  wrapTickerResearchTabDef: (pluginId: string, tab: TickerResearchTabDef) => TickerResearchTabDef;
  wrapBrokerAdapter?: (broker: BrokerAdapter, pluginId: string) => BrokerAdapter;
}

function setUnique<T>(map: Map<string, T>, id: string, value: T): void {
  if (map.has(id)) throw new Error(`Duplicate plugin contribution id: ${id}`);
  map.set(id, value);
}

export class RegistryContributions {
  readonly pluginItems = new Map<string, PluginItems>();
  readonly commandOwners = new Map<string, string>();
  readonly commandBarSearchProviderOwners = new Map<string, string>();
  readonly documentSearchProviderOwners = new Map<string, string>();
  readonly chartSeriesCatalogOwners = new Map<string, string>();
  readonly alertConditionsMap = new Map<string, AlertConditionDef>();
  readonly alertConditionOwners = new Map<string, string>();
  readonly paneOwners = new Map<string, string>();
  readonly paneTemplateOwners = new Map<string, string>();
  readonly shortcutOwners = new Map<string, string>();
  readonly capabilityOwners = new Map<string, string>();
  readonly tickerResearchTabOwners = new Map<string, string>();

  readonly panesMap = new Map<string, PaneDef>();
  readonly paneTemplatesMap = new Map<string, PaneTemplateDef>();
  readonly commandsMap = new Map<string, CommandDef>();
  readonly commandBarSearchProvidersMap = new Map<string, CommandBarSearchProvider>();
  readonly documentSearchProvidersMap = new Map<string, DocumentSearchProvider>();
  readonly chartSeriesCatalogsMap = new Map<string, ChartSeriesCatalogProvider>();
  readonly columnsMap = new Map<string, CustomColumnDef>();
  readonly brokersMap = new Map<string, BrokerAdapter>();
  readonly tickerResearchTabsMap = new Map<string, TickerResearchTabDef>();
  readonly shortcutsMap = new Map<string, KeyboardShortcut>();
  readonly tickerActionsMap = new Map<string, TickerAction>();
  readonly contextMenuProvidersMap = new Map<string, ContextMenuProviderEntry>();

  constructor(private readonly options: RegistryContributionsOptions) {}

  getOrCreatePluginItems(pluginId: string): PluginItems {
    const existing = this.pluginItems.get(pluginId);
    if (existing) return existing;

    const items: PluginItems = {
      panes: [],
      paneTemplates: [],
      commands: [],
      commandBarSearchProviders: [],
      documentSearchProviders: [],
      chartSeriesCatalogs: [],
      alertConditions: [],
      columns: [],
      brokers: [],
      capabilities: [],
      tickerResearchTabs: [],
      shortcuts: [],
      tickerActions: [],
      contextMenuProviders: [],
      agentTools: [],
      agentPromptFragments: [],
      eventDisposers: [],
      capabilityDisposers: [],
      newsQueryWatchDisposers: [],
    };
    this.pluginItems.set(pluginId, items);
    return items;
  }

  registerPane(pluginId: string, pane: PaneDef | LoosePaneDef, items = this.getOrCreatePluginItems(pluginId)): void {
    const normalized = normalizeRegisteredPane(pane);
    setUnique(this.panesMap, normalized.id, this.options.wrapPaneDef(pluginId, normalized));
    this.paneOwners.set(normalized.id, pluginId);
    items.panes.push(normalized.id);
  }

  registerPaneTemplate(pluginId: string, template: PaneTemplateDef, items = this.getOrCreatePluginItems(pluginId)): void {
    setUnique(this.paneTemplatesMap, template.id, template);
    this.paneTemplateOwners.set(template.id, pluginId);
    items.paneTemplates.push(template.id);
  }

  registerCommand(pluginId: string, command: CommandDef, items = this.getOrCreatePluginItems(pluginId)): void {
    setUnique(this.commandsMap, command.id, command);
    this.commandOwners.set(command.id, pluginId);
    items.commands.push(command.id);
  }

  registerCommandBarSearchProvider(
    pluginId: string,
    provider: CommandBarSearchProvider,
    items = this.getOrCreatePluginItems(pluginId),
  ): () => void {
    setUnique(this.commandBarSearchProvidersMap, provider.id, provider);
    this.commandBarSearchProviderOwners.set(provider.id, pluginId);
    items.commandBarSearchProviders.push(provider.id);
    return () => {
      // Only the registration still in place may be withdrawn: a re-registered
      // provider under the same id belongs to whoever registered it last.
      if (this.commandBarSearchProvidersMap.get(provider.id) !== provider) return;
      this.commandBarSearchProvidersMap.delete(provider.id);
      this.commandBarSearchProviderOwners.delete(provider.id);
      items.commandBarSearchProviders = items.commandBarSearchProviders.filter((id) => id !== provider.id);
    };
  }

  registerColumn(_pluginId: string, column: CustomColumnDef, items: PluginItems): void {
    setUnique(this.columnsMap, column.id, column);
    items.columns.push(column.id);
  }

  registerDocumentSearchProvider(
    pluginId: string,
    provider: DocumentSearchProvider,
    items = this.getOrCreatePluginItems(pluginId),
  ): () => void {
    setUnique(this.documentSearchProvidersMap, provider.id, provider);
    this.documentSearchProviderOwners.set(provider.id, pluginId);
    items.documentSearchProviders.push(provider.id);
    return () => {
      if (this.documentSearchProvidersMap.get(provider.id) !== provider) return;
      this.documentSearchProvidersMap.delete(provider.id);
      this.documentSearchProviderOwners.delete(provider.id);
      items.documentSearchProviders = items.documentSearchProviders.filter((id) => id !== provider.id);
    };
  }

  registerChartSeriesCatalog(
    pluginId: string,
    provider: ChartSeriesCatalogProvider,
    items = this.getOrCreatePluginItems(pluginId),
  ): () => void {
    setUnique(this.chartSeriesCatalogsMap, provider.id, provider);
    this.chartSeriesCatalogOwners.set(provider.id, pluginId);
    items.chartSeriesCatalogs.push(provider.id);
    return () => {
      if (this.chartSeriesCatalogsMap.get(provider.id) !== provider) return;
      this.chartSeriesCatalogsMap.delete(provider.id);
      this.chartSeriesCatalogOwners.delete(provider.id);
      items.chartSeriesCatalogs = items.chartSeriesCatalogs.filter((id) => id !== provider.id);
    };
  }

  registerAlertCondition(
    pluginId: string,
    condition: AlertConditionDef,
    items = this.getOrCreatePluginItems(pluginId),
  ): void {
    setUnique(this.alertConditionsMap, condition.id, condition);
    this.alertConditionOwners.set(condition.id, pluginId);
    items.alertConditions.push(condition.id);
  }

  registerBroker(pluginId: string, broker: BrokerAdapter, items = this.getOrCreatePluginItems(pluginId)): void {
    setUnique(this.brokersMap, broker.id, this.options.wrapBrokerAdapter?.(broker, pluginId) ?? broker);
    items.brokers.push(broker.id);
  }

  registerCapability(pluginId: string, capabilityId: string, items: PluginItems): void {
    this.capabilityOwners.set(capabilityId, pluginId);
    items.capabilities.push(capabilityId);
  }

  registerTickerResearchTab(pluginId: string, tab: TickerResearchTabDef, items = this.getOrCreatePluginItems(pluginId)): void {
    setUnique(this.tickerResearchTabsMap, tab.id, this.options.wrapTickerResearchTabDef(pluginId, tab));
    this.tickerResearchTabOwners.set(tab.id, pluginId);
    items.tickerResearchTabs.push(tab.id);
  }

  registerShortcut(pluginId: string, shortcut: KeyboardShortcut, items = this.getOrCreatePluginItems(pluginId)): void {
    setUnique(this.shortcutsMap, shortcut.id, shortcut);
    this.shortcutOwners.set(shortcut.id, pluginId);
    items.shortcuts.push(shortcut.id);
  }

  registerTickerAction(_pluginId: string, action: TickerAction, items: PluginItems): void {
    setUnique(this.tickerActionsMap, action.id, action);
    items.tickerActions.push(action.id);
  }

  registerContextMenuProvider(pluginId: string, provider: ContextMenuProviderDef, items: PluginItems): void {
    const providerKey = `${pluginId}:${provider.id}`;
    this.contextMenuProvidersMap.set(providerKey, { pluginId, provider });
    items.contextMenuProviders.push(providerKey);
  }

  unregister(pluginId: string): void {
    const items = this.pluginItems.get(pluginId);
    if (!items) return;

    for (const paneId of items.panes) {
      this.panesMap.delete(paneId);
      this.paneOwners.delete(paneId);
    }
    for (const templateId of items.paneTemplates) {
      this.paneTemplatesMap.delete(templateId);
      this.paneTemplateOwners.delete(templateId);
    }
    for (const commandId of items.commands) {
      this.commandsMap.delete(commandId);
      this.commandOwners.delete(commandId);
    }
    for (const providerId of items.commandBarSearchProviders) {
      this.commandBarSearchProvidersMap.delete(providerId);
      this.commandBarSearchProviderOwners.delete(providerId);
    }
    for (const columnId of items.columns) this.columnsMap.delete(columnId);
    for (const providerId of items.documentSearchProviders) {
      this.documentSearchProvidersMap.delete(providerId);
      this.documentSearchProviderOwners.delete(providerId);
    }
    for (const providerId of items.chartSeriesCatalogs) {
      this.chartSeriesCatalogsMap.delete(providerId);
      this.chartSeriesCatalogOwners.delete(providerId);
    }
    for (const conditionId of items.alertConditions) {
      this.alertConditionsMap.delete(conditionId);
      this.alertConditionOwners.delete(conditionId);
    }
    for (const brokerId of items.brokers) this.brokersMap.delete(brokerId);
    for (const capabilityId of items.capabilities) this.capabilityOwners.delete(capabilityId);
    for (const tabId of items.tickerResearchTabs) {
      this.tickerResearchTabsMap.delete(tabId);
      this.tickerResearchTabOwners.delete(tabId);
    }
    for (const shortcutId of items.shortcuts) {
      this.shortcutsMap.delete(shortcutId);
      this.shortcutOwners.delete(shortcutId);
    }
    for (const actionId of items.tickerActions) this.tickerActionsMap.delete(actionId);
    for (const providerKey of items.contextMenuProviders) this.contextMenuProvidersMap.delete(providerKey);
    for (const toolName of items.agentTools) dropQueuedAgentTool(toolName);
    for (const fragment of items.agentPromptFragments) dropQueuedAgentPromptFragment(fragment);
    let disposeError: unknown;
    for (const dispose of [...items.eventDisposers, ...items.capabilityDisposers, ...items.newsQueryWatchDisposers]) {
      try {
        dispose();
      } catch (error) {
        disposeError ??= error;
      }
    }
    this.pluginItems.delete(pluginId);
    if (disposeError) throw disposeError;
  }
}
