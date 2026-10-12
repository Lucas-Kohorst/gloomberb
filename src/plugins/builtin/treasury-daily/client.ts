import { httpFetch } from "../../../utils/http-transport";
import type { CashAccount, DebtDay, OperatingCash } from "./model";

const CASH_URL = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance?sort=-record_date&page[size]=40";
const DEBT_URL = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?sort=-record_date&page[size]=20";
const FETCH_TIMEOUT_MS = 15_000;
const DEBT_DAYS = 20;

export interface TreasuryDaily {
  cash: OperatingCash;
  debt: DebtDay[];
}

function text(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function recordDate(value: unknown): string | null {
  const date = text(value);
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

/** Balances arrive as strings. The string "null" means the figure was not published. */
function amount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = text(value);
  if (!raw || raw.toLowerCase() === "null") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function isBusinessDay(iso: string): boolean {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

function rowsOf(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== "object" || !("data" in payload) || !Array.isArray(payload.data)) {
    throw new Error("Treasury response was not recognized");
  }
  return payload.data.filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
}

export function parseOperatingCash(payload: unknown): OperatingCash {
  const parsed: Array<CashAccount & { date: string }> = [];
  for (const row of rowsOf(payload)) {
    const date = recordDate(row.record_date);
    const account = text(row.account_type);
    if (!date || !account) continue;
    const line = text(row.src_line_nbr);
    parsed.push({
      id: `${date}:${line ?? account}`,
      date,
      account,
      opening: amount(row.open_today_bal),
      closing: amount(row.close_today_bal),
    });
  }
  const recordDateValue = parsed.reduce<string | null>((latest, row) => (
    latest == null || row.date > latest ? row.date : latest
  ), null);
  return {
    recordDate: recordDateValue,
    rows: parsed.filter((row) => row.date === recordDateValue).map((row) => ({
      id: row.id,
      account: row.account,
      opening: row.opening,
      closing: row.closing,
    })),
  };
}

export function parseDebtToPenny(payload: unknown): DebtDay[] {
  const byDate = new Map<string, DebtDay>();
  for (const row of rowsOf(payload)) {
    const date = recordDate(row.record_date);
    if (!date || !isBusinessDay(date) || byDate.has(date)) continue;
    byDate.set(date, {
      id: date,
      date,
      heldByPublic: amount(row.debt_held_public_amt),
      intragovernmental: amount(row.intragov_hold_amt),
      total: amount(row.tot_pub_debt_out_amt),
    });
  }
  return [...byDate.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, DEBT_DAYS);
}

async function readJson(url: string, label: string, signal?: AbortSignal): Promise<unknown> {
  const response = await httpFetch(url, {
    headers: { Accept: "application/json" },
    signal: signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${label} request failed (${response.status})`);
  return response.json() as Promise<unknown>;
}

export async function fetchTreasuryDaily(signal?: AbortSignal): Promise<TreasuryDaily> {
  const [cash, debt] = await Promise.all([
    readJson(CASH_URL, "Treasury cash", signal),
    readJson(DEBT_URL, "Treasury debt", signal),
  ]);
  return { cash: parseOperatingCash(cash), debt: parseDebtToPenny(debt) };
}
