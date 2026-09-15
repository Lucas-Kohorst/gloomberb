import { apiClient } from "../../../api-client";
import type { GloomPlugin } from "../../../types/plugin";
import { registerConnectionSource } from "../connections/register";
import { teamStore } from "../cloud/team/store";
import { exportNotesToDirectory, exportSourceLabel } from "./export";
import { NotesFiles } from "./files";
import { createQuickNotesPane } from "./quick-notes-pane";
import { NotesStoreRegistry } from "./store";
import { createNotesSyncContributor } from "./sync";
import { createNotesTab } from "./ticker-notes-tab";

let disposeNotes: (() => void) | null = null;
let disposeConnection: (() => void) | null = null;

export const notesPlugin: GloomPlugin = {
  id: "notes",
  name: "Notes",
  version: "1.0.0",
  description: "Add markdown notes to your tickers, personally or shared with a team.",
  toggleable: true,

  setup(ctx) {
    const dataDir = ctx.getConfig().dataDir;
    const notesFiles = new NotesFiles(dataDir);
    const registry = new NotesStoreRegistry({
      persistence: ctx.persistence,
      files: notesFiles,
      isSignedIn: () => apiClient.isVerified(),
    });
    const NotesTab = createNotesTab(registry);
    let pendingSearchQuery = "";
    const QuickNotesPane = createQuickNotesPane(registry, () => {
      const query = pendingSearchQuery;
      pendingSearchQuery = "";
      return query;
    });

    ctx.registerSyncContributor(createNotesSyncContributor(notesFiles));

    disposeConnection = registerConnectionSource({
      id: "gloom-cloud:notes",
      name: "Gloom Cloud Notes",
      kind: "data",
      pluginId: "notes",
    });

    const disposers = [
      apiClient.subscribeCurrentUser(() => {
        registry.invalidateAll();
      }),
      apiClient.subscribeCloudEvent("note.updated", () => registry.invalidateAll()),
      apiClient.subscribeCloudEvent("note.deleted", () => registry.invalidateAll()),
    ];

    ctx.on("ticker:removed", ({ symbol }) => {
      notesFiles.delete(symbol).catch((error) => {
        console.error("[notes] Failed to delete ticker note:", error);
        ctx.notify({ body: "Failed to delete note. Check disk space and permissions.", type: "error" });
      });
    });

    ctx.registerTickerResearchTab({
      id: "notes",
      name: "Notes",
      order: 50,
      component: NotesTab,
    });

    ctx.registerPane({
      id: "quick-notes",
      name: "Notes",
      icon: "N",
      component: QuickNotesPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 60, height: 20 },
    });

    ctx.registerPaneTemplate({
      id: "new-quick-notes-pane",
      paneId: "quick-notes",
      label: "Notes",
      description: "Open a general-purpose notes scratchpad",
      keywords: ["notes", "quick", "scratchpad", "memo"],
      shortcut: { prefix: "NOTE", argPlaceholder: "search", argKind: "text", argOptional: true },
      createInstance: (_context, options) => {
        pendingSearchQuery = options?.arg ?? "";
        return { placement: "floating" };
      },
    });

    ctx.registerCommand({
      id: "notes-export",
      label: "Export Notes",
      description: "Write every note, yours and your teams', as Markdown files",
      keywords: ["notes", "export", "markdown", "backup"],
      category: "data",
      execute: async () => {
        const stamp = new Date().toISOString().slice(0, 10);
        const dir = `${dataDir}/notes-export-${stamp}`;
        const teams = teamStore.getSnapshot().teams;
        const sources = [
          { label: exportSourceLabel(registry.personal()), store: registry.personal() },
          ...teams.map((team) => ({
            label: exportSourceLabel(registry.forOwner({ kind: "team", teamId: team.id }), team.name),
            store: registry.forOwner({ kind: "team", teamId: team.id }),
          })),
        ];
        try {
          const result = await exportNotesToDirectory(dir, sources);
          ctx.notify({
            body: `Exported ${result.files} ${result.files === 1 ? "note" : "notes"} to ${result.dir}`,
            type: "success",
          });
        } catch (error) {
          ctx.notify({ body: error instanceof Error ? error.message : "Could not export notes.", type: "error" });
        }
      },
    });

    disposeNotes = () => {
      for (const dispose of disposers) dispose();
    };
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
    disposeNotes?.();
    disposeNotes = null;
  },
};
