import type { DataTableColumn } from "../../../components";

export type PluginColumnId = "name" | "description" | "version" | "source" | "status";

export type PluginColumn = DataTableColumn & { id: PluginColumnId };

export function buildPluginColumns(): PluginColumn[] {
  return [
    { id: "name", label: "NAME", width: 10, align: "left", flexGrow: 1 },
    { id: "description", label: "DESCRIPTION", width: 16, align: "left" },
    { id: "version", label: "VERSION", width: 8, align: "left" },
    { id: "source", label: "SOURCE", width: 9, align: "left" },
    { id: "status", label: "STATUS", width: 9, align: "left" },
  ];
}
