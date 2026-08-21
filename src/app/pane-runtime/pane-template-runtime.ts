import { useCallback, type Dispatch } from "react";
import { getPaneTemplateDisplayLabel } from "../../components/command-bar/pane-templates/items";
import { createPaneTemplateOrThrow } from "../../components/command-bar/workflow/ops";
import type { AppTickerRepositoryPort } from "../../core/app-service-ports";
import type { PluginRegistry } from "../../plugins/registry";
import type { AppAction, AppState } from "../../state/app/context";
import type { LayoutConfig, PaneBinding, PaneInstanceConfig } from "../../types/config";
import type { DataProvider } from "../../types/data-provider";
import type {
  PaneDef,
  PaneTemplateCreateOptions,
  PaneTemplateInstanceConfig,
  WizardStep,
} from "../../types/plugin";
import type { DialogApi } from "../../ui/dialog";
import { runPaneTemplateDialogWizard } from "../pane-template-dialog-wizard";

interface UseAppPaneTemplateRuntimeOptions {
  buildPaneInstance: (paneType: string, options?: {
    title?: string;
    binding?: PaneBinding;
    params?: Record<string, string>;
    settings?: Record<string, unknown>;
    instanceId?: string;
  }) => PaneInstanceConfig | null;
  dataProvider: DataProvider;
  dialog: DialogApi;
  dispatch: Dispatch<AppAction>;
  notify: (body: string, options?: { type?: "info" | "success" | "error" }) => void;
  focusVisiblePane: (paneId: string, layout?: LayoutConfig) => void;
  placePaneInstance: (
    instance: PaneInstanceConfig,
    paneDef: PaneDef,
    options?: PaneTemplateInstanceConfig,
  ) => void;
  pluginRegistry: PluginRegistry;
  stateRef: { current: AppState };
  tickerRepository: AppTickerRepositoryPort;
  persistLayout: (layout: LayoutConfig, options?: { pushHistory?: boolean }) => void;
}

export function useAppPaneTemplateRuntime({
  buildPaneInstance,
  dataProvider,
  dialog,
  dispatch,
  notify,
  focusVisiblePane,
  placePaneInstance,
  pluginRegistry,
  stateRef,
  tickerRepository,
  persistLayout,
}: UseAppPaneTemplateRuntimeOptions) {
  const runPaneTemplateWizard = useCallback((steps: WizardStep[]) => (
    runPaneTemplateDialogWizard(dialog, steps)
  ), [dialog]);

  const createPaneFromTemplate = useCallback(async (templateId: string, options?: PaneTemplateCreateOptions) => {
    const template = pluginRegistry.paneTemplates.get(templateId);
    if (!template) return;

    let resolvedOptions = options;
    const shouldRunDialogWizard = !!template.wizard
      && template.wizard.length > 0
      && !options?.values
      && (!options?.arg || template.wizard.some((step) => step.type === "textarea"));
    if (shouldRunDialogWizard && template.wizard) {
      const wizardSteps = options?.arg && template.shortcut?.argPlaceholder
        ? template.wizard.map((step) => (
          step.key === template.shortcut?.argPlaceholder
            ? { ...step, defaultValue: options.arg }
            : step
        ))
        : template.wizard;
      const values = await runPaneTemplateWizard(wizardSteps);
      if (!values) return;
      resolvedOptions = {
        ...options,
        values,
        arg: template.shortcut?.argPlaceholder ? values[template.shortcut.argPlaceholder] : options?.arg,
      };
    }

    try {
      await createPaneTemplateOrThrow(templateId, resolvedOptions, {
        dataProvider,
        tickerRepository,
        persistLayout,
        pluginRegistry,
        dispatch,
        getState: () => stateRef.current,
        buildPaneInstance,
        placePaneInstance,
        focusPaneInstance: focusVisiblePane,
      });
    } catch (error) {
      notify(
        error instanceof Error ? error.message : `Could not create ${getPaneTemplateDisplayLabel(template).toLowerCase()}.`,
        { type: "info" },
      );
    }
  }, [
    buildPaneInstance,
    dataProvider,
    dispatch,
    focusVisiblePane,
    notify,
    placePaneInstance,
    pluginRegistry,
    runPaneTemplateWizard,
    persistLayout,
    stateRef,
    tickerRepository,
  ]);

  return { createPaneFromTemplate };
}
