export const IBORROWDESK_PLUGIN_ID = "iborrowdesk";
export const IBORROWDESK_CONNECTION_ID = "iborrowdesk";
export const IBORROWDESK_PANE_ID = "iborrowdesk";

export const IBORROWDESK_BASE_URL = "https://www.iborrowdesk.com";
export const IBORROWDESK_REPORT_URL = `${IBORROWDESK_BASE_URL}/report`;

export type BorrowMoverDirection = "up" | "down";

/** One row of the fee-movers tables: the biggest fee changes right now. */
export interface BorrowMover {
  symbol: string;
  name: string;
  /** Current borrow fee in annualized percent. */
  latestFee: number;
  /** Fee when the move started, for computing the direction magnitude. */
  startFee: number;
  feeChange: number;
  latestAvailable: number | null;
  updated: Date;
}

export interface BorrowMoversPage {
  up: BorrowMover[];
  down: BorrowMover[];
  updated: Date | null;
}

/** One day of the borrow-fee history series. */
export interface BorrowDay {
  date: string;
  fee: number;
  rebate: number | null;
  available: number | null;
}

/** Borrow snapshot for one symbol from `/api/ticker/<sym>`. */
export interface BorrowSnapshot {
  symbol: string;
  name: string | null;
  /** Latest annualized borrow fee in percent; null when not borrowable data. */
  latestFee: number | null;
  /** Shares available to borrow. */
  available: number | null;
  /** True when IB reports the availability figure is stale. */
  availableStale: boolean;
  country: string | null;
  days: BorrowDay[];
  updated: Date | null;
}
