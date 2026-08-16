import type { DataTableColumn } from "../../../components";

export type ByokColumnId = "name" | "service" | "key" | "url" | "status" | "validated";

export type ByokColumn = DataTableColumn & { id: ByokColumnId };

interface ColumnSpec {
  id: ByokColumnId;
  label: string;
  min: number;
  flex: number;
}

const NAME: ColumnSpec = { id: "name", label: "Name", min: 12, flex: 2 };
const SERVICE: ColumnSpec = { id: "service", label: "Service", min: 12, flex: 0 };
const KEY: ColumnSpec = { id: "key", label: "Key", min: 10, flex: 0 };
const URL: ColumnSpec = { id: "url", label: "API URL", min: 16, flex: 3 };
const STATUS: ColumnSpec = { id: "status", label: "Status", min: 8, flex: 0 };
const VALIDATED: ColumnSpec = { id: "validated", label: "Validated", min: 10, flex: 0 };

const COLUMN_SETS: ColumnSpec[][] = [
  [NAME, SERVICE, KEY, URL, STATUS, VALIDATED],
  [NAME, SERVICE, URL, STATUS, VALIDATED],
  [NAME, SERVICE, STATUS, VALIDATED],
  [NAME, SERVICE, STATUS],
  [NAME, STATUS],
];

const COLUMN_GAP = 1;
const HORIZONTAL_PADDING = 1;

function minTableWidth(specs: ColumnSpec[]): number {
  return specs.reduce((sum, spec) => sum + spec.min, 0)
    + specs.length * COLUMN_GAP
    + HORIZONTAL_PADDING * 2;
}

function layoutColumns(specs: ColumnSpec[], width: number): ByokColumn[] {
  const extra = Math.max(0, Math.floor(width) - minTableWidth(specs));
  const flexSum = specs.reduce((sum, spec) => sum + spec.flex, 0);
  let assigned = 0;
  const flexIndexes = specs.flatMap((spec, index) => spec.flex > 0 ? [index] : []);
  const lastFlex = flexIndexes[flexIndexes.length - 1];

  return specs.map((spec, index) => {
    let grow = 0;
    if (flexSum > 0 && spec.flex > 0) {
      if (index === lastFlex) grow = extra - assigned;
      else {
        grow = Math.floor(extra * spec.flex / flexSum);
        assigned += grow;
      }
    }
    return {
      id: spec.id,
      label: spec.label,
      width: spec.min + grow,
      align: "left" as const,
      flexGrow: spec.flex > 0 ? spec.flex : undefined,
    };
  });
}

/** Builds API-key table columns that fit the current pane width. */
export function buildByokColumns(width: number): ByokColumn[] {
  const target = Math.max(20, Math.floor(width));
  const specs = COLUMN_SETS.find((set) => minTableWidth(set) <= target) ?? COLUMN_SETS[COLUMN_SETS.length - 1]!;
  return layoutColumns(specs, target);
}

export function byokTableWidth(columns: readonly ByokColumn[]): number {
  return columns.reduce((sum, column) => sum + column.width + COLUMN_GAP, HORIZONTAL_PADDING * 2);
}
