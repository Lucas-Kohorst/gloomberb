import { toDisplayName, toVariableName } from "../commands/plugins";

export type ScaffoldTemplate =
  | "pane-only"
  | "data-pane"
  | "chart-source"
  | "document-source"
  | "research-tab"
  | "command-only";

export const SCAFFOLD_TEMPLATES: readonly ScaffoldTemplate[] = [
  "pane-only",
  "data-pane",
  "chart-source",
  "document-source",
  "research-tab",
  "command-only",
];

export const SCAFFOLD_TEMPLATE_DESCRIPTIONS: Record<ScaffoldTemplate, string> = {
  "pane-only": "A pane with a command-bar template and shortcut.",
  "data-pane": "A data pane with a headless model, client stub, and connection source.",
  "chart-source": "A chart-series catalog and resolver with a connection source (no pane).",
  "document-source": "A document search provider with a connection source (no pane).",
  "research-tab": "A Ticker Research tab with an agent prompt fragment.",
  "command-only": "A command-bar command with an agent prompt fragment (no pane).",
};

export interface ScaffoldFile {
  filename: string;
  content: string;
}

export interface ScaffoldOutput {
  files: ScaffoldFile[];
  description: string;
}

function shortcutPrefix(name: string): string {
  return name.replace(/-/g, "").slice(0, 4).toUpperCase() || "PANE";
}

function pascalCase(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function buildPackageJson(name: string): string {
  return JSON.stringify(
    {
      name,
      version: "0.1.0",
      description: "A Gloomberb plugin.",
      main: "index.ts",
    },
    null,
    2,
  ) + "\n";
}

// ---------------------------------------------------------------------------
// pane-only
// ---------------------------------------------------------------------------

function paneOnly(name: string): ScaffoldOutput {
  const varName = toVariableName(name);
  const displayName = toDisplayName(name);
  const shortcut = shortcutPrefix(name);

  return {
    description: SCAFFOLD_TEMPLATE_DESCRIPTIONS["pane-only"],
    files: [
      { filename: "package.json", content: buildPackageJson(name) },
      {
        filename: "index.ts",
        content: `import type { GloomPlugin } from "gloomberb/types/plugin";

export const ${varName}: GloomPlugin = {
  id: "${name}",
  name: "${displayName}",
  version: "0.1.0",
  description: "${displayName} pane.",
  toggleable: true,
  panes: [{
    id: "${name}",
    name: "${displayName}",
    icon: "P",
    component: () => null,
  }],
  paneTemplates: [{
    id: "${name}-pane",
    paneId: "${name}",
    label: "${displayName}",
    description: "${displayName} pane. Open with pane.createFromTemplate ${name}-pane.",
    keywords: ["${name}"],
    shortcut: { prefix: "${shortcut}" },
  }],
  setup(ctx) {
    ctx.registerAgentPromptFragment(
      "${displayName}: pane.createFromTemplate ${name}-pane (${shortcut}).",
    );
  },
};

export default ${varName};
`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// data-pane
// ---------------------------------------------------------------------------

function dataPane(name: string): ScaffoldOutput {
  const varName = toVariableName(name);
  const displayName = toDisplayName(name);
  const pascal = pascalCase(name);
  const shortcut = shortcutPrefix(name);

  return {
    description: SCAFFOLD_TEMPLATE_DESCRIPTIONS["data-pane"],
    files: [
      { filename: "package.json", content: buildPackageJson(name) },
      {
        filename: "client.ts",
        content: `import { withConnectionRequest } from "gloomberb/plugins";

export interface ${varName}Data {
  rows: Array<{ label: string; value: string }>;
}

export async function load${pascal}Data(signal: AbortSignal): Promise<${varName}Data> {
  return withConnectionRequest("${name}", "fetch", async () => {
    // Replace with your API call. Honor the abort signal.
    signal;
    return { rows: [{ label: "Example", value: "42" }] };
  });
}
`,
      },
      {
        filename: "index.ts",
        content: `import type { GloomPlugin, HeadlessPaneDefinition } from "gloomberb/types/plugin";
import { createConnection } from "gloomberb/plugins";
import { load${pascal}Data, type ${varName}Data } from "./client";

const headless = {
  shape: "rows" as const,
  argument: {
    kind: "none" as const,
    placeholder: "",
    description: "No argument needed.",
  },
  options: [],
  describe: () => "${displayName}",
  async load(_args, ctx) {
    const data = await load${displayName}Data(ctx.signal);
    return {
      columns: [
        { key: "label", header: "Label" },
        { key: "value", header: "Value" },
      ],
      rows: data.rows,
    };
  },
} satisfies HeadlessPaneDefinition<"rows">;

export const ${varName}: GloomPlugin = {
  id: "${name}",
  name: "${displayName}",
  version: "0.1.0",
  description: "${displayName} data pane with a headless model.",
  toggleable: true,
  panes: [{
    id: "${name}",
    name: "${displayName}",
    icon: "D",
    component: () => null,
    defaultPosition: "right",
    headless,
  }],
  paneTemplates: [{
    id: "${name}-pane",
    paneId: "${name}",
    label: "${displayName}",
    description: "${displayName} data pane. Open with pane.createFromTemplate ${name}-pane.",
    keywords: ["${name}"],
    shortcut: { prefix: "${shortcut}" },
  }],
  setup(ctx) {
    createConnection(ctx, {
      id: "${name}",
      name: "${displayName}",
      kind: "api",
      authRequired: false,
    });
    ctx.registerAgentPromptFragment(
      "${displayName}: pane.createFromTemplate ${name}-pane (${shortcut}).",
    );
  },
};

export default ${varName};
`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// chart-source
// ---------------------------------------------------------------------------

function chartSource(name: string): ScaffoldOutput {
  const varName = toVariableName(name);
  const displayName = toDisplayName(name);
  const pascal = pascalCase(name);
  const capId = name.replace(/-/g, "");

  return {
    description: SCAFFOLD_TEMPLATE_DESCRIPTIONS["chart-source"],
    files: [
      { filename: "package.json", content: buildPackageJson(name) },
      {
        filename: "client.ts",
        content: `import { withConnectionRequest } from "gloomberb/plugins";
import type { ResolvedSeries } from "gloomberb/capabilities";

export async function resolve${pascal}Series(
  seriesId: string,
  signal: AbortSignal,
): Promise<ResolvedSeries> {
  return withConnectionRequest("${name}", "resolve", async () => {
    // Parse seriesId and fetch data. Honor the abort signal.
    signal;
    return {
      id: \`${name}:\${seriesId}\`,
      label: seriesId,
      dataShape: "scalar",
      style: "line",
      transform: "raw",
      axis: "left",
      panelId: "main",
      interpolation: "none",
      nativeFrequency: "daily",
      unit: "USD",
      points: [],
    };
  });
}
`,
      },
      {
        filename: "index.ts",
        content: `import type { GloomPlugin } from "gloomberb/types/plugin";
import { createChartSource } from "gloomberb/plugins";
import { resolve${pascal}Series } from "./client";

export const ${varName}: GloomPlugin = {
  id: "${name}",
  name: "${displayName}",
  version: "0.1.0",
  description: "${displayName} chart-series source.",
  toggleable: true,
  setup(ctx) {
    createChartSource(ctx, {
      id: "${capId}",
      name: "${displayName}",
      catalog: {
        id: "${name}",
        name: "${displayName}",
        sourceId: "${name}",
        entries: [{
          id: "example-series",
          expression: "${capId.toUpperCase()}:EXAMPLE",
          label: "Example Series",
          source: "${displayName}",
          searchText: "example series ${name}",
          description: "Example series from ${displayName}.",
          unit: "USD",
          frequency: "daily",
        }],
        assist: {
          keywords: ["${name}"],
          examples: ["example series"],
        },
      },
      resolve: resolve${displayName}Series,
      connection: { kind: "api", authRequired: false },
    });
    ctx.registerAgentPromptFragment(
      "${displayName}: chart series source. Search for \\"${name}\\" in the chart catalog.",
    );
  },
};

export default ${varName};
`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// document-source
// ---------------------------------------------------------------------------

function documentSource(name: string): ScaffoldOutput {
  const varName = toVariableName(name);
  const displayName = toDisplayName(name);
  const pascal = pascalCase(name);

  return {
    description: SCAFFOLD_TEMPLATE_DESCRIPTIONS["document-source"],
    files: [
      { filename: "package.json", content: buildPackageJson(name) },
      {
        filename: "client.ts",
        content: `import { withConnectionRequest } from "gloomberb/plugins";
import type { DocumentSearchHit, SearchDocument } from "gloomberb/types/plugin";

export async function search${pascal}Documents(
  query: string,
  signal: AbortSignal,
): Promise<DocumentSearchHit[]> {
  return withConnectionRequest("${name}", "search", async () => {
    // Search your API. Honor the abort signal.
    signal;
    return [{
      id: "example",
      title: \`Result for \${query}\`,
      snippet: "An example document snippet.",
      source: "${displayName}",
    }];
  });
}

export async function load${pascal}Document(
  id: string,
  signal: AbortSignal,
): Promise<SearchDocument> {
  return withConnectionRequest("${name}", "load", async () => {
    // Fetch a single document by id. Honor the abort signal.
    signal;
    return {
      id,
      title: "Example Document",
      markdown: "# Example Document\\n\\nContent here.",
    };
  });
}
`,
      },
      {
        filename: "index.ts",
        content: `import type { GloomPlugin } from "gloomberb/types/plugin";
import { createDocumentSource } from "gloomberb/plugins";
import { search${pascal}Documents, load${pascal}Document } from "./client";

export const ${varName}: GloomPlugin = {
  id: "${name}",
  name: "${displayName}",
  version: "0.1.0",
  description: "${displayName} document search source.",
  toggleable: true,
  setup(ctx) {
    createDocumentSource(ctx, {
      id: "${name}",
      name: "${displayName}",
      search: search${displayName}Documents,
      load: load${displayName}Document,
      minQueryLength: 3,
      connection: { kind: "api", authRequired: false },
    });
    ctx.registerAgentPromptFragment(
      "${displayName}: document search source. Documents appear in the command bar and document search pane.",
    );
  },
};

export default ${varName};
`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// research-tab
// ---------------------------------------------------------------------------

function researchTab(name: string): ScaffoldOutput {
  const varName = toVariableName(name);
  const displayName = toDisplayName(name);

  return {
    description: SCAFFOLD_TEMPLATE_DESCRIPTIONS["research-tab"],
    files: [
      { filename: "package.json", content: buildPackageJson(name) },
      {
        filename: "index.ts",
        content: `import type { GloomPlugin, TickerResearchTabProps } from "gloomberb/types/plugin";
import { Box, Text } from "gloomberb/ui";
import { usePaneTicker, colors } from "gloomberb/components";
import { createResearchTab } from "gloomberb/plugins";

function ${varName}Tab({ width, height }: TickerResearchTabProps) {
  const { ticker } = usePaneTicker();
  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box height={1}>
        <Text fg={colors.text}>${displayName} for {ticker?.metadata.ticker ?? "—"}</Text>
      </Box>
    </Box>
  );
}

export const ${varName}: GloomPlugin = {
  id: "${name}",
  name: "${displayName}",
  version: "0.1.0",
  description: "${displayName} Ticker Research tab.",
  toggleable: true,
  setup(ctx) {
    createResearchTab(ctx, {
      tab: {
        id: "${name}",
        name: "${displayName}",
        order: 60,
        component: ${varName}Tab,
      },
      agentPrompt: "${displayName}: Ticker Research tab showing ${name} data.",
    });
  },
};

export default ${varName};
`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// command-only
// ---------------------------------------------------------------------------

function commandOnly(name: string): ScaffoldOutput {
  const varName = toVariableName(name);
  const displayName = toDisplayName(name);
  const shortcut = shortcutPrefix(name);

  return {
    description: SCAFFOLD_TEMPLATE_DESCRIPTIONS["command-only"],
    files: [
      { filename: "package.json", content: buildPackageJson(name) },
      {
        filename: "index.ts",
        content: `import type { GloomPlugin } from "gloomberb/types/plugin";

export const ${varName}: GloomPlugin = {
  id: "${name}",
  name: "${displayName}",
  version: "0.1.0",
  description: "${displayName} command.",
  toggleable: true,
  setup(ctx) {
    ctx.registerCommand({
      id: "${name}-run",
      label: "${displayName}",
      keywords: ["${name}"],
      category: "data",
      description: "Run ${displayName}.",
      shortcut: "${shortcut}",
      async execute() {
        ctx.notify({ body: "${displayName} ran.", type: "success" });
      },
    });
    ctx.registerAgentPromptFragment(
      "${displayName}: command \\"${shortcut}\\" to run ${name}.",
    );
  },
};

export default ${varName};
`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const BUILDERS: Record<ScaffoldTemplate, (name: string) => ScaffoldOutput> = {
  "pane-only": paneOnly,
  "data-pane": dataPane,
  "chart-source": chartSource,
  "document-source": documentSource,
  "research-tab": researchTab,
  "command-only": commandOnly,
};

export function buildScaffold(name: string, template: ScaffoldTemplate = "pane-only"): ScaffoldOutput {
  const builder = BUILDERS[template];
  return builder(name);
}
