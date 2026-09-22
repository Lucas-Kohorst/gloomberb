/**
 * Bravado UMA Optimistic Oracle records.
 * Field names follow https://docs.bravadotrade.com/products/uma-api
 */

export const UMA_DISPUTES_PLUGIN_ID = "uma-disputes";
export const UMA_DISPUTES_PANE_ID = "uma-disputes";
export const UMA_CONNECTION_ID = "bravado-uma";
export const BRAVADO_UMA_BYOK_SERVICE_ID = "bravado-uma";
export const BRAVADO_UMA_SECRET_SERVICE_ID = "bravado-uma-secret";

export const BRAVADO_API_ORIGIN = "https://partner-api.bravadotrade.com";
export const UMA_RECENT_PATH = "/uma/recent";

export const BRAVADO_API_KEY_ENV = "BRAVADO_API_KEY";
export const BRAVADO_API_SECRET_ENV = "BRAVADO_API_SECRET";

/** Documented `GET /uma/recent` stage filter. */
export type UmaRecentStage = "proposed" | "disputed" | "settled";

export interface UmaStageEvent {
  proposer?: string;
  disputer?: string;
  answer?: string;
  priceRaw?: string;
  requestTs?: number;
  block?: number;
  tx?: string;
  logIndex?: number;
  seenPending: boolean;
  payout?: string;
}

export interface UmaQuestion {
  questionId: string;
  conditionId: string;
  title: string;
  answer: string;
  settled: boolean;
  proposed: UmaStageEvent | null;
  disputed: UmaStageEvent | null;
  settledAt: UmaStageEvent | null;
  updatedMs: number;
  /** True when this row came from `GET /uma/recent?stage=disputed`. */
  fromDisputedFeed: boolean;
}

export interface UmaRecentPage {
  questions: UmaQuestion[];
  count: number;
}

export type UmaDisputeStage = "disputed" | "settled" | "pending";

export type UmaDisputeColumnId = "title" | "answer" | "disputer" | "updated" | "stage";
