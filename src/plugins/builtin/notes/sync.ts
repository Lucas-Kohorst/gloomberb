import type { SyncContributor } from "../../../sync/types";
import type { NotesFiles } from "./files";

export function createNotesSyncContributor(notesFiles: NotesFiles): SyncContributor {
  return {
    id: "notes",
    schemaVersion: 1,
    collect: () => notesFiles.collectAllForSync(),
    apply: (payload) => {
      if (payload && typeof payload === "object" && "quickNotesIndex" in payload) {
        return notesFiles.applySyncData(payload as never);
      }
    },
  };
}
