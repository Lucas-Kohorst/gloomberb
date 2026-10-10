import type { CommandDef, GloomPlugin, PluginConfigField, WizardStep } from "../../types/plugin";

/**
 * A plugin that declares `configSchema` gets one command bar entry that writes
 * the values into its config state. The marketplace opens the same command
 * from its `s` key, so there is exactly one setup form per plugin, built by
 * the host, with the field types the command bar already renders.
 */

export function pluginSetupCommandId(pluginId: string): string {
  return `${pluginId}:setup`;
}

function fieldValue(values: Record<string, unknown>, field: PluginConfigField): string | undefined {
  const value = values[field.key];
  if (value === undefined || value === null || value === "") return field.defaultValue;
  return String(value);
}

export function isPluginConfigured(plugin: GloomPlugin, values: Record<string, unknown>): boolean {
  if (plugin.isConfigured) return plugin.isConfigured(values);
  if (!plugin.configSchema || plugin.configSchema.length === 0) return true;
  return plugin.configSchema.every((field) => {
    if (field.required === false) return true;
    const value = values[field.key];
    return value !== undefined && value !== null && String(value).trim() !== "";
  });
}

function toWizardSteps(schema: readonly PluginConfigField[], values: Record<string, unknown>): WizardStep[] {
  return schema.map((field) => ({
    key: field.key,
    label: field.label,
    type: field.type ?? "text",
    required: field.required !== false,
    ...(field.placeholder ? { placeholder: field.placeholder } : {}),
    ...(field.options ? { options: field.options } : {}),
    ...(field.description ? { body: [field.description] } : {}),
    ...(fieldValue(values, field) !== undefined ? { defaultValue: fieldValue(values, field) } : {}),
  }));
}

function coerce(field: PluginConfigField, raw: string | undefined): unknown {
  if (raw === undefined || raw === "") return undefined;
  if (field.type === "number") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return raw;
}

export function createPluginSetupCommand(
  plugin: GloomPlugin,
  access: {
    getValues(): Record<string, unknown>;
    setValues(values: Record<string, unknown>): Promise<void>;
    notify(body: string, type: "success" | "error"): void;
  },
): CommandDef | null {
  const schema = plugin.configSchema;
  if (!schema || schema.length === 0) return null;

  const command: CommandDef = {
    id: pluginSetupCommandId(plugin.id),
    label: `Set up ${plugin.name}`,
    description: plugin.description ? `Settings for ${plugin.name}` : undefined,
    keywords: ["setup", "configure", "settings", "api key", plugin.id, plugin.name.toLowerCase()],
    category: "config",
    wizardLayout: "form",
    async execute(values = {}) {
      const next: Record<string, unknown> = {};
      for (const field of schema) {
        const value = coerce(field, values[field.key]);
        if (value !== undefined) next[field.key] = value;
      }
      try {
        await access.setValues(next);
        access.notify(`${plugin.name} is set up.`, "success");
      } catch (error) {
        access.notify(`Could not save ${plugin.name} settings: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  };

  // The command bar reads `wizard` when it opens the form, so the current
  // values become the defaults each time rather than once at registration.
  Object.defineProperty(command, "wizard", {
    enumerable: true,
    get: () => toWizardSteps(schema, access.getValues()),
  });

  return command;
}
