import type { PluginModule } from "../plugin-module";
import {
  copyAndDownloadCsv,
  csvFileName,
  getActivePaneCsvSnapshot,
  serializePaneCsv,
} from "../../../components/data-table/csv-export";

export const paneCsvModule: PluginModule = {
  setup(ctx) {
    ctx.registerCommand({
      id: "export-pane-csv",
      label: "Export pane CSV",
      description: "Copy the focused pane's table to CSV and download it.",
      keywords: ["csv", "export", "download", "table", "copy", "spreadsheet"],
      category: "data",
      shortcut: "CSV",
      async execute() {
        const snapshot = getActivePaneCsvSnapshot();
        if (!snapshot || snapshot.columns.length === 0) {
          ctx.notify({ body: "Focus a table pane, then run CSV.", type: "info" });
          return;
        }
        const text = serializePaneCsv(snapshot);
        const fileName = csvFileName(snapshot.title);
        const result = await copyAndDownloadCsv(text, fileName);
        if (result === "failed") {
          ctx.notify({ body: "Could not copy or download CSV.", type: "error" });
          return;
        }
        if (result === "both") {
          ctx.notify({ body: `Copied and downloaded ${fileName}`, type: "success" });
          return;
        }
        if (result === "downloaded") {
          ctx.notify({ body: `Downloaded ${fileName}`, type: "success" });
          return;
        }
        ctx.notify({ body: "CSV copied to clipboard", type: "success" });
      },
    });
  },
};
