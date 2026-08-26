import type { DataTableColumn } from "../../../components";

export type InspectorColumnId = "id" | "name" | "version" | "source" | "status";

export type InspectorColumn = DataTableColumn & { id: InspectorColumnId };

const ID: ColumnSpec = { id: "id", label: "ID", min: 10, flex: 2 };
const NAME: ColumnSpec = { id: "name", label: "NAME", min: 10, flex: 2 };
const VERSION: ColumnSpec = { id: "version", label: "VERSION", min: 8, flex: 0 };
const SOURCE: ColumnSpec = { id: "source", label: "SOURCE", min: 9, flex: 0 };
const STATUS: ColumnSpec = { id: "status", label: "STATUS", min: 9, flex: 0 };

interface ColumnSpec {
  id: InspectorColumnId;
  label: string;
  min: number;
  flex: number;
}

const COLUMN_SETS: ColumnSpec[][] = [
  [ID, NAME, VERSION, SOURCE, STATUS],
  [ID, NAME, VERSION, STATUS],
  [ID, NAME, STATUS],
  [ID, STATUS],
];

const COLUMN_GAP = 1;
const HORIZONTAL_PADDING = 1;

function minTableWidth(specs: ColumnSpec[]): number {
  return specs.reduce((sum, spec) => sum + spec.min, 0)
    + specs.length * COLUMN_GAP
    + HORIZONTAL_PADDING * 2;
}

function layoutColumns(specs: ColumnSpec[], width: number): InspectorColumn[] {
  const extra = Math.max(0, Math.floor(width) - minTableWidth(specs));
  const flexSum = specs.reduce((sum, spec) => sum + spec.flex, 0);
  let assigned = 0;
  const flexIndexes = specs.flatMap((spec, index) => (spec.flex > 0 ? [index] : []));
  const lastFlex = flexIndexes[flexIndexes.length - 1];

  return specs.map((spec, index) => {
    let grow = 0;
    if (flexSum > 0 && spec.flex > 0) {
      if (index === lastFlex) {
        grow = extra - assigned;
      } else {
        grow = Math.floor((extra * spec.flex) / flexSum);
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

/** Builds inspector-table columns that fit the current pane width. */
export function buildInspectorColumns(width: number): InspectorColumn[] {
  const target = Math.max(20, Math.floor(width));
  const specs = COLUMN_SETS.find((set) => minTableWidth(set) <= target) ?? COLUMN_SETS[COLUMN_SETS.length - 1]!;
  return layoutColumns(specs, target);
}
