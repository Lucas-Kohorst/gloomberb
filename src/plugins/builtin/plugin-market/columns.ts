import type { DataTableColumn } from "../../../components";

export type PluginColumnId = "name" | "description" | "version" | "source" | "status";

export type PluginColumn = DataTableColumn & { id: PluginColumnId };

const NAME: ColumnSpec = { id: "name", label: "NAME", min: 10, flex: 2 };
const DESC: ColumnSpec = { id: "description", label: "DESCRIPTION", min: 16, flex: 4 };
const VERSION: ColumnSpec = { id: "version", label: "VERSION", min: 8, flex: 0 };
const SOURCE: ColumnSpec = { id: "source", label: "SOURCE", min: 9, flex: 0 };
const STATUS: ColumnSpec = { id: "status", label: "STATUS", min: 8, flex: 0 };

interface ColumnSpec {
  id: PluginColumnId;
  label: string;
  min: number;
  flex: number;
}

const COLUMN_SETS: ColumnSpec[][] = [
  [NAME, DESC, VERSION, SOURCE, STATUS],
  [NAME, DESC, VERSION, STATUS],
  [NAME, DESC, STATUS],
  [NAME, STATUS],
];

const COLUMN_GAP = 1;
const HORIZONTAL_PADDING = 1;

function minTableWidth(specs: ColumnSpec[]): number {
  return specs.reduce((sum, spec) => sum + spec.min, 0)
    + specs.length * COLUMN_GAP
    + HORIZONTAL_PADDING * 2;
}

function layoutColumns(specs: ColumnSpec[], width: number): PluginColumn[] {
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

/** Builds plugin-table columns that fit the current pane width. */
export function buildPluginColumns(width: number): PluginColumn[] {
  const target = Math.max(20, Math.floor(width));
  const specs = COLUMN_SETS.find((set) => minTableWidth(set) <= target) ?? COLUMN_SETS[COLUMN_SETS.length - 1]!;
  return layoutColumns(specs, target);
}
