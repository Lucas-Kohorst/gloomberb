import { SelectButton } from "../../../components";
import { Box } from "../../../ui";
import {
  DOC_TYPE_OPTIONS,
  RANGE_OPTIONS,
  type SearchFilters,
  type SearchDocumentType,
  type SearchRangeKey,
} from "./model";

const TYPE_OPTIONS = [
  { value: "all", label: "All" },
  ...DOC_TYPE_OPTIONS,
];

const RANGE_SELECT_OPTIONS = RANGE_OPTIONS.filter((option) => option.value !== "custom");

/**
 * Same SelectButton row the scanner uses: muted labels, native selects on
 * desktop. The tab strip and results table keep the arrow keys.
 */
export function SearchFilterBar({
  filters,
  onChange,
  width,
  sourceOptions,
}: {
  filters: SearchFilters;
  onChange: (next: SearchFilters) => void;
  width: number;
  sourceOptions: Array<{ value: string; label: string }>;
}) {
  const compact = width < 84;
  const typeValue = filters.docTypes.length === 1 ? filters.docTypes[0] : "all";
  const sourceValue = filters.sourceIds?.length === 1 ? filters.sourceIds[0] : "all";
  const rangeValue = filters.range === "custom" ? "all" : filters.range;

  return (
    <Box flexDirection="row" flexWrap={compact ? "wrap" : "nowrap"} gap={2} overflow="hidden">
      <SelectButton
        label="Type"
        value={typeValue}
        options={TYPE_OPTIONS}
        emphasized={typeValue !== "all"}
        onChange={(value) => onChange({
          ...filters,
          docTypes: value === "all" ? [] : [value as SearchDocumentType],
        })}
      />
      {sourceOptions.length > 0 ? (
        <SelectButton
          label="Source"
          value={sourceValue}
          options={[{ value: "all", label: "All" }, ...sourceOptions]}
          emphasized={sourceValue !== "all"}
          onChange={(value) => onChange({
            ...filters,
            sourceIds: value === "all" ? [] : [value],
          })}
        />
      ) : null}
      <SelectButton
        label="Range"
        value={rangeValue}
        options={RANGE_SELECT_OPTIONS}
        emphasized={rangeValue !== "all"}
        onChange={(value) => onChange({
          ...filters,
          range: value as SearchRangeKey,
          from: undefined,
          to: undefined,
        })}
      />
    </Box>
  );
}
