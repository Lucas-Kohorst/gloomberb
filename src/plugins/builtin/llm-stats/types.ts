export const LLM_STATS_PLUGIN_ID = "llm-stats";
export const LLM_STATS_PANE_ID = "llm-stats";
export const LLM_STATS_CONNECTION_ID = "artificial-analysis";

export const ARTIFICIAL_ANALYSIS_SERVICE_ID = "artificial-analysis";
export const ARTIFICIAL_ANALYSIS_API_BASE = "https://artificialanalysis.ai/api/v2";
export const ARTIFICIAL_ANALYSIS_SITE = "https://artificialanalysis.ai";
export const ARTIFICIAL_ANALYSIS_ENV_VAR = "ARTIFICIAL_ANALYSIS_API_KEY";
export const ARTIFICIAL_ANALYSIS_ATTRIBUTION = "artificialanalysis.ai";

export type AaFamily = "language" | "image" | "video" | "speech" | "music";

export type AaTab =
  | "intelligence"
  | "coding"
  | "agentic"
  | "price-speed"
  | "image"
  | "video"
  | "audio"
  | "models";

export type AaSortColumnId =
  | "model"
  | "org"
  | "intelligence"
  | "coding"
  | "agentic"
  | "speed"
  | "ttft"
  | "e2e"
  | "input"
  | "output"
  | "elo"
  | "wer";

export interface AaModelRow {
  id: string;
  slug: string;
  name: string;
  creator: string;
  creatorSlug: string;
  family: AaFamily;
  category: string;
  releaseDate: string | null;
  url: string;
  intelligence: number | null;
  coding: number | null;
  agentic: number | null;
  speed: number | null;
  ttftSeconds: number | null;
  e2eSeconds: number | null;
  inputPrice: number | null;
  outputPrice: number | null;
  elo: number | null;
  ci95: number | null;
  bba: number | null;
  fdb: number | null;
  tau: number | null;
  wer: number | null;
}

export interface AaCatalogMetric {
  code: string;
  label: string;
  kind: string;
  unit: string;
  unitGroup: string;
}

export interface ArtificialAnalysisData {
  rows: AaModelRow[];
  tier: string | null;
  intelligenceIndexVersion: number | null;
  fetchedAt: number;
}

export interface AaAuthError extends Error {
  code: "missing-key" | "unauthorized";
}

export function isAaAuthError(error: unknown): error is AaAuthError {
  return !!error
    && typeof error === "object"
    && "code" in error
    && ((error as AaAuthError).code === "missing-key" || (error as AaAuthError).code === "unauthorized");
}
