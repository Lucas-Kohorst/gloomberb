import type { DataTableColumn } from "../../../components";

export type ByokColumnId = "name" | "service" | "key" | "url" | "status" | "validated";

export type ByokColumn = DataTableColumn & { id: ByokColumnId };

export function buildByokColumns(): ByokColumn[] {
  return [
    { id: "name", label: "Name", width: 12, align: "left", flexGrow: 1 },
    { id: "service", label: "Service", width: 12, align: "left" },
    { id: "key", label: "Key", width: 10, align: "left" },
    { id: "url", label: "API URL", width: 16, align: "left" },
    { id: "status", label: "Status", width: 8, align: "left" },
    { id: "validated", label: "Validated", width: 10, align: "left" },
  ];
}
