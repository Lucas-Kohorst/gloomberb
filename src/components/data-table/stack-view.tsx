import { useShortcut } from "../../react/input";
import { type ReactNode } from "react";
import { Box } from "../../ui";
import {
  DataTableView,
  type DataTableKeyEvent,
  type DataTableViewProps,
} from "./view";
import { PageStackView, type DataTableColumn } from "../ui";

export interface DataTableStackViewProps<
  T,
  C extends DataTableColumn = DataTableColumn,
> extends Omit<DataTableViewProps<T, C>, "focused"> {
  focused: boolean;
  detailOpen: boolean;
  onBack: () => void;
  detailContent: ReactNode;
  detailTitle?: string;
  onDetailKeyDown?: (event: DataTableKeyEvent) => boolean | void;
  /** Drawn above the table and hidden with it when the detail page is open. */
  rootBefore?: ReactNode;
}

export function DataTableStackView<
  T,
  C extends DataTableColumn = DataTableColumn,
>({
  focused,
  detailOpen,
  onBack,
  detailContent,
  detailTitle,
  keyboardNavigation = true,
  onDetailKeyDown,
  rootBefore,
  ...tableProps
}: DataTableStackViewProps<T, C>) {
  useShortcut((event) => {
    if (!focused || !detailOpen || !keyboardNavigation) return;
    onDetailKeyDown?.(event);
  });

  const tableHeight = rootBefore && tableProps.rootHeight != null
    ? Math.max(1, tableProps.rootHeight - 1)
    : tableProps.rootHeight;
  const table = (
    <DataTableView<T, C>
      {...tableProps}
      rootHeight={tableHeight}
      focused={focused && !detailOpen}
      keyboardNavigation={keyboardNavigation}
    />
  );
  const rootContent = rootBefore ? (
    <Box flexDirection="column" width={tableProps.rootWidth} height={tableProps.rootHeight}>
      {rootBefore}
      {table}
    </Box>
  ) : table;

  return (
    <PageStackView
      focused={focused}
      detailOpen={detailOpen}
      onBack={onBack}
      rootContent={rootContent}
      detailContent={detailContent}
      detailTitle={detailTitle}
    />
  );
}
