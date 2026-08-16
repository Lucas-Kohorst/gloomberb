import type { WizardStep } from "../../../types/plugin";
import type { AiProvider, AiProviderDefinition } from "./providers";
import {
  getAiProviderDefinition,
  getAiProviderUnavailableLabel,
  migrateLegacyAiProviderId,
  resolveDefaultAiProviderId,
} from "./providers";
import {
  getModelTierBadge,
  getModelTierMetaForId,
  pickModelByTier,
  type ModelTier,
} from "./model-tiers";
import {
  getAiRuntimeCatalog,
  type AiRunOutputMode,
  type AiRuntimeCatalog,
} from "./runner";

export const AI_AUTO_MODEL_VALUE = "__auto__";

/**
 * AI features that pick their own default model. The screener favours fast
 * models (structured output, high volume); ask-AI and the workspace favour
 * quality (reasoning, analysis).
 */
export type AiFeatureId = "screener" | "ask-ai" | "workspace";

/**
 * User-facing speed-vs-quality toggle. "auto" applies the per-feature default
 * (speed for screener, quality for ask-AI/workspace).
 */
export type AiModelPreference = "auto" | "speed" | "quality";

export const AI_MODEL_PREFERENCE_VALUES: readonly AiModelPreference[] = ["auto", "speed", "quality"];

export const AI_MODEL_PREFERENCE_LABELS: Readonly<Record<AiModelPreference, string>> = {
  auto: "Auto (screener: fast, ask-AI/agent: quality)",
  speed: "Speed (fast models everywhere)",
  quality: "Quality (powerful models everywhere)",
};

const FEATURE_DEFAULT_PREFERENCE: Readonly<Record<AiFeatureId, "speed" | "quality">> = {
  "screener": "speed",
  "ask-ai": "quality",
  "workspace": "quality",
};

export interface AiRunnerSelectionScope {
  outputMode?: AiRunOutputMode;
  defaultProviderId?: string | null;
  defaultModelId?: string | null;
  runtimeCatalog?: AiRuntimeCatalog;
}

export interface AiRunnerDefault {
  providerId: string;
  modelId: string | null;
}

export interface AiModelSelectionOption {
  value: string;
  label: string;
  description?: string;
}

export function isAiProviderReady(provider: AiProvider): boolean {
  return provider.available && (provider.status === undefined || provider.status === "ready");
}

export function supportsAiRunOutputMode(
  provider: AiProvider,
  outputMode: AiRunOutputMode,
  runtimeCatalog = getAiRuntimeCatalog(),
): boolean {
  const runtimeProvider = runtimeCatalog.providers.find((candidate) => (
    candidate.providerId === provider.id
  ));
  return (runtimeProvider?.outputModes ?? provider.outputModes).includes(outputMode);
}

export function getSelectableAiRunners(
  providers: readonly AiProvider[],
  scope: AiRunnerSelectionScope = {},
): AiProvider[] {
  const outputMode = scope.outputMode ?? "plain";
  const catalog = scope.runtimeCatalog ?? getAiRuntimeCatalog();
  const capable = providers.filter((provider) => (
    supportsAiRunOutputMode(provider, outputMode, catalog)
  ));
  return capable;
}

export function normalizeAiModelId(value: string | null | undefined): string | null {
  const modelId = value?.trim() ?? "";
  return modelId && modelId !== AI_AUTO_MODEL_VALUE ? modelId : null;
}

/**
 * Resolves the effective speed-vs-quality preference for a feature. "auto"
 * maps to the feature's curated default (speed for screener, quality
 * otherwise); explicit "speed"/"quality" overrides apply everywhere.
 */
export function resolveFeatureModelPreference(
  feature: AiFeatureId,
  configuredPreference?: AiModelPreference | null,
): "speed" | "quality" {
  if (configuredPreference === "speed" || configuredPreference === "quality") {
    return configuredPreference;
  }
  return FEATURE_DEFAULT_PREFERENCE[feature];
}

/**
 * Desired model tier for a resolved preference. "speed" → fast, "quality" →
 * powerful (falling back to balanced when no powerful model exists).
 */
export function preferenceToTargetTier(preference: "speed" | "quality"): ModelTier {
  return preference === "speed" ? "fast" : "powerful";
}

function availableModelIdsForProvider(
  providerId: string,
  runtimeCatalog: AiRuntimeCatalog,
): string[] {
  const canonicalProviderId = migrateLegacyAiProviderId(providerId);
  return runtimeCatalog.models
    .filter((model) => model.providerId === canonicalProviderId && model.available)
    .map((model) => model.id);
}

function definitionModelIdsForTier(
  definition: AiProviderDefinition,
  preference: "speed" | "quality",
): readonly string[] {
  return preference === "speed" ? definition.fastModelIds : definition.preferredModelIds;
}

/**
 * Resolves the default model id for a feature on a connected provider.
 *
 * When the preference is "speed", fast model ids are tried first; when
 * "quality", the curated quality ids are tried first. In both cases the
 * runtime catalog's available models gate the choice, and a tier-based fallback
 * picks the closest available model when no curated id is available.
 */
export function resolveFeatureDefaultModelId(
  providerId: string,
  feature: AiFeatureId,
  preference: AiModelPreference | null | undefined,
  runtimeCatalog: AiRuntimeCatalog = getAiRuntimeCatalog(),
): string | null {
  const canonicalProviderId = migrateLegacyAiProviderId(providerId);
  const definition = getAiProviderDefinition(canonicalProviderId);
  if (!definition) return null;
  const resolvedPreference = resolveFeatureModelPreference(feature, preference);
  const orderedIds = definitionModelIdsForTier(definition, resolvedPreference);
  const availableIds = availableModelIdsForProvider(canonicalProviderId, runtimeCatalog);

  // First pass: first curated id that is available to the connected account.
  const curatedMatch = orderedIds
    .map((modelId) => availableIds.find((available) => available === modelId))
    .find((candidate): candidate is string => candidate !== undefined);
  if (curatedMatch) return curatedMatch;

  // Second pass: pick the best available model by tier when the account has
  // models but none of the curated ids match (e.g. a restricted plan).
  if (availableIds.length > 0) {
    return pickModelByTier(availableIds, preferenceToTargetTier(resolvedPreference));
  }

  // No connected-account info yet (catalog not loaded). Use the first curated
  // id so a sensible default is shown before the provider is connected.
  return orderedIds[0] ?? definition.preferredModelIds[0] ?? null;
}

export function getAiModelSelectionOptions(
  providerId: string,
  currentModelId?: string | null,
  runtimeCatalog = getAiRuntimeCatalog(),
): AiModelSelectionOption[] {
  const canonicalProviderId = migrateLegacyAiProviderId(providerId);
  const provider = runtimeCatalog.providers.find((candidate) => (
    candidate.providerId === canonicalProviderId
  ));
  const models = runtimeCatalog.models.filter((model) => (
    model.providerId === canonicalProviderId
  ));
  const defaultModel = models.find((model) => model.id === provider?.defaultModelId);
  const options: AiModelSelectionOption[] = [
    {
      value: AI_AUTO_MODEL_VALUE,
      label: defaultModel
        ? `Auto · ${defaultModel.label}`
        : provider?.defaultModelId
          ? `Auto · ${provider.defaultModelId}`
          : "Auto · provider default",
      description: "Use the provider's recommended model.",
    },
    ...models.map((model) => {
      const tierMeta = getModelTierMetaForId(model.id);
      return {
        value: model.id,
        label: model.available ? model.label : `${model.label} · connect to use`,
        description: model.available
          ? `${tierMeta.badge} · ${tierMeta.description}`
          : `${tierMeta.badge} · available after the provider is connected.`,
      };
    }),
  ];
  const normalizedCurrent = normalizeAiModelId(currentModelId);
  if (normalizedCurrent && !models.some((model) => model.id === normalizedCurrent)) {
    options.push({
      value: normalizedCurrent,
      label: `${normalizedCurrent} · current`,
      description: "Saved before the current Pi model catalog was loaded.",
    });
  }
  return options;
}

export function getAiRunnerWizardModelKey(providerId: string): string {
  return `modelId:${migrateLegacyAiProviderId(providerId)}`;
}

export function resolveAiRunnerWizardModel(
  values: Record<string, string> | undefined,
  providerId: string,
  fallbackModelId?: string | null,
): string | null {
  const selected = values?.[getAiRunnerWizardModelKey(providerId)]
    ?? values?.modelId
    ?? fallbackModelId;
  return normalizeAiModelId(selected);
}

export function modelIdAfterAiProviderChange(
  providerId: string,
  defaultProviderId: string,
  defaultModelId: string | null | undefined,
): string {
  return migrateLegacyAiProviderId(providerId) === migrateLegacyAiProviderId(defaultProviderId)
    ? normalizeAiModelId(defaultModelId) ?? ""
    : "";
}

export function resolveReadyAiRunnerDefault(
  providers: readonly AiProvider[],
  configuredProviderId?: string | null,
  configuredModelId?: string | null,
): AiRunnerDefault {
  const configuredId = migrateLegacyAiProviderId(configuredProviderId?.trim() ?? "");
  const configured = providers.find((provider) => provider.id === configuredId);
  const ready = providers.find(isAiProviderReady);
  const providerId = configured && (isAiProviderReady(configured) || !ready)
    ? configured.id
    : ready?.id ?? resolveDefaultAiProviderId(providers);
  return {
    providerId,
    modelId: providerId === configuredId ? normalizeAiModelId(configuredModelId) : null,
  };
}

export function buildAiRunnerWizard(
  providers: readonly AiProvider[],
  scope: AiRunnerSelectionScope = {},
): WizardStep[] {
  const runners = getSelectableAiRunners(providers, scope);
  const defaults = resolveReadyAiRunnerDefault(
    runners,
    scope.defaultProviderId,
    scope.defaultModelId,
  );
  const runtimeCatalog = scope.runtimeCatalog ?? getAiRuntimeCatalog();
  return [
    {
      key: "providerId",
      label: "AI Provider",
      type: "select",
      defaultValue: defaults.providerId,
      options: runners.map((provider) => ({
        label: isAiProviderReady(provider)
          ? provider.name
          : `${provider.name} (${getAiProviderUnavailableLabel(provider)})`,
        value: provider.id,
      })),
      body: ["Choose the AI provider for this conversation."],
    },
    ...runners.map((provider): WizardStep => {
      const selectedModelId = provider.id === defaults.providerId ? defaults.modelId : null;
      return {
        key: getAiRunnerWizardModelKey(provider.id),
        label: "AI Model",
        type: "select",
        required: true,
        dependsOn: { key: "providerId", value: provider.id },
        defaultValue: selectedModelId ?? AI_AUTO_MODEL_VALUE,
        options: getAiModelSelectionOptions(provider.id, selectedModelId, runtimeCatalog),
        body: ["Choose from the models published by Pi, or use the provider default."],
      };
    }),
  ];
}

export function formatAiRunnerSelection(providerName: string, modelId: string | null | undefined): string {
  return normalizeAiModelId(modelId) ? `${providerName} · ${normalizeAiModelId(modelId)}` : providerName;
}
