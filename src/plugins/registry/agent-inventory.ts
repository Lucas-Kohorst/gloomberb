import type { CommandDef, PaneTemplateDef } from "../../types/plugin";

export function missingAgentVisibleDescriptions(registry: {
  commands: ReadonlyMap<string, Pick<CommandDef, "id" | "description" | "hidden">>;
  paneTemplates: ReadonlyMap<string, Pick<PaneTemplateDef, "id" | "description">>;
}): { commands: string[]; templates: string[] } {
  const commands = [...registry.commands.values()]
    .filter((command) => !command.hidden?.() && !command.description?.trim())
    .map((command) => command.id)
    .sort();
  const templates = [...registry.paneTemplates.values()]
    .filter((template) => !template.description.trim())
    .map((template) => template.id)
    .sort();
  return { commands, templates };
}
