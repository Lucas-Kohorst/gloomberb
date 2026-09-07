import type { DataTableColumn } from "../../../components";

export type InspectorColumnId = "id" | "name" | "version" | "source" | "status";

export type InspectorColumn = DataTableColumn & { id: InspectorColumnId };

export function buildInspectorColumns(): InspectorColumn[] {
  return [
    { id: "id", label: "ID", width: 10, align: "left", flexGrow: 1 },
    { id: "name", label: "NAME", width: 10, align: "left" },
    { id: "version", label: "VERSION", width: 8, align: "left" },
    { id: "source", label: "SOURCE", width: 9, align: "left" },
    { id: "status", label: "STATUS", width: 9, align: "left" },
  ];
}
