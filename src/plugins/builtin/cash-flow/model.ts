import type { DataTableColumn } from "../../../components";
import type { FinancialStatement } from "../../../types/financials";
import { formatCurrency } from "../../../utils/format";

export type CashFlowPeriod = "annual" | "quarterly";

export type CashFlowField =
  | "operatingCashFlow"
  | "depreciationAndAmortization"
  | "stockBasedCompensation"
  | "changeInWorkingCapital"
  | "capitalExpenditure"
  | "freeCashFlow"
  | "investingCashFlow"
  | "purchaseOfPPE"
  | "saleOfPPE"
  | "purchaseOfBusiness"
  | "saleOfBusiness"
  | "purchaseOfInvestment"
  | "saleOfInvestment"
  | "financingCashFlow"
  | "issuanceOfDebt"
  | "repaymentOfDebt"
  | "repurchaseOfCapitalStock"
  | "commonStockIssuance"
  | "cashDividendsPaid"
  | "beginningCashPosition"
  | "changesInCash"
  | "endCashPosition"
  | "effectOfExchangeRateChanges";

type CashFlowRowDefinition = {
  label: string;
  field: CashFlowField;
  emphasis?: boolean;
};

type CashFlowSectionDefinition = {
  id: string;
  label: string;
  rows: CashFlowRowDefinition[];
};

const CASH_FLOW_SECTIONS: CashFlowSectionDefinition[] = [
  {
    id: "operating",
    label: "Operating Activities",
    rows: [
      { label: "Operating Cash Flow", field: "operatingCashFlow" },
      { label: "Depreciation & Amortization", field: "depreciationAndAmortization" },
      { label: "Stock-Based Compensation", field: "stockBasedCompensation" },
      { label: "Change in Working Capital", field: "changeInWorkingCapital" },
      { label: "Capital Expenditure", field: "capitalExpenditure" },
      { label: "Free Cash Flow", field: "freeCashFlow", emphasis: true },
    ],
  },
  {
    id: "investing",
    label: "Investing Activities",
    rows: [
      { label: "Investing Cash Flow", field: "investingCashFlow" },
      { label: "Purchase of PPE", field: "purchaseOfPPE" },
      { label: "Sale of PPE", field: "saleOfPPE" },
      { label: "Purchase of Business", field: "purchaseOfBusiness" },
      { label: "Sale of Business", field: "saleOfBusiness" },
      { label: "Purchase of Investment", field: "purchaseOfInvestment" },
      { label: "Sale of Investment", field: "saleOfInvestment" },
    ],
  },
  {
    id: "financing",
    label: "Financing Activities",
    rows: [
      { label: "Financing Cash Flow", field: "financingCashFlow" },
      { label: "Issuance of Debt", field: "issuanceOfDebt" },
      { label: "Repayment of Debt", field: "repaymentOfDebt" },
      { label: "Repurchase of Stock", field: "repurchaseOfCapitalStock" },
      { label: "Common Stock Issuance", field: "commonStockIssuance" },
      { label: "Cash Dividends Paid", field: "cashDividendsPaid" },
    ],
  },
  {
    id: "summary",
    label: "Summary",
    rows: [
      { label: "Beginning Cash Position", field: "beginningCashPosition" },
      { label: "Changes in Cash", field: "changesInCash" },
      { label: "End Cash Position", field: "endCashPosition" },
      { label: "Effect of Exchange Rate", field: "effectOfExchangeRateChanges" },
    ],
  },
];

export type CashFlowTableRow =
  | {
    kind: "section";
    id: string;
    label: string;
  }
  | {
    kind: "metric";
    id: string;
    label: string;
    field: CashFlowField;
    emphasis: boolean;
  };

export type CashFlowColumn = DataTableColumn & (
  | {
    id: "metric";
    kind: "metric";
  }
  | {
    id: string;
    kind: "period";
    statement: FinancialStatement;
  }
);

export function statementCashFlowValue(
  statement: FinancialStatement,
  field: CashFlowField,
): number | undefined {
  return statement[field];
}

function hasStatementValue(statements: readonly FinancialStatement[], field: CashFlowField): boolean {
  return statements.some((statement) => typeof statementCashFlowValue(statement, field) === "number");
}

/**
 * Keep the statement hierarchy intact while hiding line items that the
 * provider did not return for the selected ticker.
 */
export function buildCashFlowRows(statements: readonly FinancialStatement[]): CashFlowTableRow[] {
  const rows: CashFlowTableRow[] = [];
  for (const section of CASH_FLOW_SECTIONS) {
    const visibleRows = section.rows.filter((row) => hasStatementValue(statements, row.field));
    if (visibleRows.length === 0) continue;

    rows.push({
      kind: "section",
      id: `section:${section.id}`,
      label: section.label,
    });
    rows.push(...visibleRows.map((row) => ({
      kind: "metric" as const,
      id: `metric:${row.field}`,
      label: row.label,
      field: row.field,
      emphasis: row.emphasis === true,
    })));
  }
  return rows;
}

export function formatCashFlowPeriod(date: string, period: CashFlowPeriod): string {
  const year = date.slice(0, 4);
  if (period === "annual") return year;

  const month = Number(date.slice(5, 7));
  if (Number.isInteger(month) && month >= 1 && month <= 12) {
    return `${year} Q${Math.ceil(month / 3)}`;
  }
  return date.slice(0, 10);
}

export function selectCashFlowStatements(
  statements: readonly FinancialStatement[],
): FinancialStatement[] {
  return [...statements].sort((left, right) => right.date.localeCompare(left.date));
}

export function buildCashFlowColumns(
  statements: readonly FinancialStatement[],
  period: CashFlowPeriod,
): CashFlowColumn[] {
  return [
    {
      id: "metric",
      kind: "metric",
      label: "CASH FLOW",
      width: 30,
      align: "left",
      flexGrow: 1,
    },
    ...statements.map((statement, index): CashFlowColumn => ({
      id: `period:${statement.date}:${index}`,
      kind: "period",
      statement,
      label: formatCashFlowPeriod(statement.date, period),
      width: 16,
      align: "right",
    })),
  ];
}

export function formatCashFlowValue(
  value: number | undefined,
  currency: string,
): string {
  return formatCurrency(value, currency);
}

export function resolveCashFlowPeriod(
  requested: CashFlowPeriod,
  hasAnnualStatements: boolean,
  hasQuarterlyStatements: boolean,
): CashFlowPeriod {
  if (requested === "annual") {
    return hasAnnualStatements || !hasQuarterlyStatements ? "annual" : "quarterly";
  }
  return hasQuarterlyStatements || !hasAnnualStatements ? "quarterly" : "annual";
}
