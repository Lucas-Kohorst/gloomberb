import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { GloomPluginContext, PaneTemplateDef } from "../types/plugin";

/** Compact prompt line that tells the agent how to open this plugin's panes. */
export function buildPluginAgentPrompt(options: {
  label: string;
  templates: Array<Pick<PaneTemplateDef, "id" | "shortcut">>;
  howTo: string;
}): string {
  const opens = options.templates.slice(0, 6).map((template) => {
    const prefix = template.shortcut?.prefix;
    const seed = template.shortcut?.argKind ? " options.arg" : "";
    return `pane.createFromTemplate ${template.id}${seed}${prefix ? ` (${prefix})` : ""}`;
  });
  const extra = options.templates.length > 6
    ? ` +${options.templates.length - 6} more in app://pane-templates.`
    : "";
  return `${options.label}: ${opens.join("; ")}.${extra} ${options.howTo}`.trim();
}

/** Register the prompt fragment (and optional tools) every plugin should expose. */
export function registerPluginAgentHarness(
  ctx: GloomPluginContext,
  options: {
    prompt: string;
    tools?: AgentTool[];
  },
): void {
  ctx.registerAgentPromptFragment(options.prompt);
  for (const tool of options.tools ?? []) {
    ctx.registerAgentTool(tool);
  }
}
