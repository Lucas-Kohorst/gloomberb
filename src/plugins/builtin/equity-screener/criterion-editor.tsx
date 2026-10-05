import { useState } from "react";
import { Box } from "../../../ui";
import { Button, SelectButton, TextField } from "../../../components";
import { useShortcut } from "../../../public/react";
import { useDialog } from "../../../ui/dialog";
import type {
  ScreenCriterion,
  ScreenFieldDefinition,
  ScreenOperator,
} from "../../../api-client/equity-screener";
import { parseCriterion } from "./model";
import { chooseOption, Notice } from "./widgets";

const OPERATOR_LABELS: Record<ScreenOperator, string> = {
  gte: "At least",
  lte: "At most",
  gt: "Above",
  lt: "Below",
  eq: "Equals",
  between: "Between",
  in: "One of",
  present: "Available",
  missing: "Unavailable",
};

export function CriterionEditor({
  fields,
  value,
  onSave,
  onCancel,
  focused,
  width,
}: {
  fields: ScreenFieldDefinition[];
  value: ScreenCriterion | null;
  onSave: (criterion: ScreenCriterion) => void;
  onCancel: () => void;
  focused: boolean;
  width: number;
}) {
  const dialog = useDialog();
  const [fieldId, setFieldId] = useState(
    value?.field ??
      (fields.find((row) => row.id === "trailingPE") ??
        fields.find((row) => row.kind === "number") ??
        fields[0]!).id,
  );
  const field = fields.find((row) => row.id === fieldId)!;
  const [operator, setOperator] = useState<ScreenOperator>(
    value?.op ?? field.operators[0]!,
  );
  const [text, setText] = useState(
    value && "value" in value
      ? Array.isArray(value.value)
        ? value.value.join(", ")
        : String(value.value)
      : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState("field");
  const ring = [
    "field",
    "operator",
    ...(["present", "missing"].includes(operator) ? [] : ["value"]),
    "save",
    "cancel",
  ];
  const save = () => {
    try {
      onSave(parseCriterion(field, operator, text));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Invalid criterion.");
    }
  };
  const openField = () => {
    void chooseOption(
      dialog,
      "Field",
      fieldId,
      fields.map((row) => ({ value: row.id, label: row.label })),
    ).then((id) => {
      const next = fields.find((row) => row.id === id);
      if (!next) return;
      setFieldId(next.id);
      setOperator(next.operators[0]!);
      setError(null);
    });
  };
  const openOperator = () => {
    void chooseOption(
      dialog,
      "Operator",
      operator,
      field.operators.map((op) => ({ value: op, label: OPERATOR_LABELS[op] })),
    ).then((next) => {
      const match = field.operators.find((op) => op === next);
      if (match) setOperator(match);
    });
  };
  useShortcut(
    (event) => {
      if (event.name === "tab") {
        event.preventDefault();
        event.stopPropagation();
        setActive((current) => ring[(ring.indexOf(current) + (event.shift ? -1 : 1) + ring.length) % ring.length]!);
      } else if (event.name === "escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      } else if (
        ["enter", "return"].includes(event.name ?? "") &&
        !event.targetEditable
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (active === "field") openField();
        else if (active === "operator") openOperator();
        else if (active === "cancel") onCancel();
        else save();
      }
    },
    {
      enabled: focused,
      allowEditable: true,
      phase: "before",
      scope: "equity-screen-criterion",
    },
  );
  return (
    <Box paddingX={1} paddingTop={1} flexDirection="column" gap={1}>
      <SelectButton
        label="Field"
        emphasized={focused && active === "field"}
        value={fieldId}
        options={fields.map((row) => ({ value: row.id, label: row.label }))}
        onChange={(id) => {
          setFieldId(id);
          const next = fields.find((row) => row.id === id)!;
          setOperator(next.operators[0]!);
          setError(null);
          setActive("field");
        }}
      />
      <SelectButton
        label="Operator"
        emphasized={focused && active === "operator"}
        value={operator}
        options={field.operators.map((op) => ({ value: op, label: OPERATOR_LABELS[op] }))}
        onChange={(next) => {
          setOperator(next);
          setActive("operator");
        }}
      />
      {!["present", "missing"].includes(operator) ? (
        <TextField
          label={`Value${field.unit ? ` (${field.unit})` : ""}`}
          value={text}
          onChange={setText}
          placeholder={
            operator === "between"
              ? "minimum, maximum"
              : operator === "in"
                ? "comma-separated values"
                : "threshold, e.g. 25 or 10B"
          }
          width={Math.min(45, width - 4)}
          focused={focused && active === "value"}
          onMouseDown={() => setActive("value")}
          onSubmit={save}
        />
      ) : null}
      {error ? <Notice tone="negative">{error}</Notice> : null}
      <Box flexDirection="row" gap={1}>
        <Button
          label="Save criterion"
          variant="primary"
          active={focused && active === "save"}
          onPress={save}
        />
        <Button
          label="Cancel"
          variant="secondary"
          active={focused && active === "cancel"}
          onPress={onCancel}
        />
      </Box>
    </Box>
  );
}
