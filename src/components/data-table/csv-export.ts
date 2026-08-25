/** Last focused table snapshot so CSV can run from the command bar. */

export const PANE_CSV_MAX_ROWS = 5_000;

export interface PaneCsvSnapshot {
  paneId: string;
  title: string;
  focused: boolean;
  columns: readonly string[];
  rows: () => readonly (readonly string[])[];
}

const snapshots = new Map<string, PaneCsvSnapshot>();
let activeSnapshot: PaneCsvSnapshot | null = null;

export function resetPaneCsvSnapshots(): void {
  snapshots.clear();
  activeSnapshot = null;
}

export function publishPaneCsvSnapshot(snapshot: PaneCsvSnapshot): () => void {
  snapshots.set(snapshot.paneId, snapshot);
  // Command bar steals pane focus; keep exporting the table the user was on.
  if (snapshot.focused || activeSnapshot?.paneId === snapshot.paneId) {
    activeSnapshot = snapshot;
  }
  return () => {
    if (snapshots.get(snapshot.paneId) === snapshot) snapshots.delete(snapshot.paneId);
    if (activeSnapshot === snapshot) {
      activeSnapshot = [...snapshots.values()].find((entry) => entry.focused)
        ?? [...snapshots.values()].at(-1)
        ?? null;
    }
  };
}

export function getActivePaneCsvSnapshot(): PaneCsvSnapshot | null {
  return activeSnapshot;
}

export function csvEscape(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function serializePaneCsv(snapshot: PaneCsvSnapshot): string {
  const header = snapshot.columns.map(csvEscape).join(",");
  const lines = snapshot.rows().slice(0, PANE_CSV_MAX_ROWS).map((row) => (
    row.map((cell) => csvEscape(cell)).join(",")
  ));
  return `${[header, ...lines].join("\n")}\n`;
}

export function csvFileName(title: string, now = new Date()): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "pane";
  const stamp = now.toISOString().slice(0, 19).replace(/:/g, "-");
  return `${slug}-${stamp}.csv`;
}

function downloadBrowserFile(contents: string, fileName: string): boolean {
  const documentRef = globalThis.document;
  const urlApi = globalThis.URL;
  if (!documentRef || typeof urlApi?.createObjectURL !== "function") return false;
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8" });
  const href = urlApi.createObjectURL(blob);
  const link = documentRef.createElement("a");
  link.href = href;
  link.download = fileName;
  link.rel = "noopener";
  documentRef.body.appendChild(link);
  link.click();
  link.remove();
  urlApi.revokeObjectURL(href);
  return true;
}

function writeDownloadsFile(contents: string, fileName: string): boolean {
  try {
    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    const os = require("os") as typeof import("os");
    const filepath = path.join(os.homedir(), "Downloads", fileName);
    fs.writeFileSync(filepath, contents);
    return true;
  } catch {
    return false;
  }
}

export type PaneCsvDelivery = "copied" | "downloaded" | "both" | "failed";

export async function copyAndDownloadCsv(
  text: string,
  fileName: string,
): Promise<PaneCsvDelivery> {
  let copied = false;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch {
    copied = false;
  }

  const downloaded = downloadBrowserFile(text, fileName) || writeDownloadsFile(text, fileName);
  if (copied && downloaded) return "both";
  if (copied) return "copied";
  if (downloaded) return "downloaded";
  return "failed";
}
