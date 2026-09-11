import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { withConnectionRequest } from "../connections/register";
import {
  CLINICAL_TRIALS_API_BASE_URL,
  CLINICAL_TRIALS_CONNECTION_ID,
  CLINICAL_TRIALS_STUDY_BASE_URL,
  type ClinicalTrial,
  type ClinicalTrialsPage,
} from "./types";

export const TRIALS_DISPLAY_CAP = 50;
const DEFAULT_PAGE_SIZE = 25;

const trialsFetch = createThrottledFetch({
  requestsPerMinute: 20,
  maxRetries: 2,
  timeoutMs: 15_000,
  backoffBaseMs: 500,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": "gloomberb-clinical-trials",
  },
  transport: (url: string, init?: RequestInit) => httpFetch(url, init),
});

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? asString(item) : undefined))
    .filter((item): item is string => item !== undefined);
}

function asCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function asDate(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function moduleOf(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * Parse one v2 study record (`{ protocolSection: { ... } }`) into a trial.
 * Returns null when the record has no NCT id.
 */
export function parseClinicalTrial(raw: unknown): ClinicalTrial | null {
  if (!raw || typeof raw !== "object") return null;
  const study = raw as Record<string, unknown>;
  const protocol = moduleOf(study, "protocolSection");
  const identification = moduleOf(protocol, "identificationModule");
  const nctId = asString(identification.nctId);
  if (!nctId) return null;

  const statusModule = moduleOf(protocol, "statusModule");
  const sponsors = moduleOf(protocol, "sponsorCollaboratorsModule");
  const leadSponsor = moduleOf(sponsors, "leadSponsor");
  const design = moduleOf(protocol, "designModule");
  const conditionsModule = moduleOf(protocol, "conditionsModule");
  const description = moduleOf(protocol, "descriptionModule");
  const enrollmentInfo = moduleOf(design, "enrollmentInfo");

  const briefTitle = asString(identification.briefTitle)
    ?? asString(identification.officialTitle)
    ?? nctId;

  return {
    nctId,
    title: briefTitle,
    officialTitle: asString(identification.officialTitle) ?? briefTitle,
    status: asString(statusModule.overallStatus) ?? "UNKNOWN",
    phases: asStringArray(design.phases),
    sponsor: asString(leadSponsor.name) ?? "Unknown sponsor",
    sponsorClass: asString(leadSponsor.class) ?? "",
    conditions: asStringArray(conditionsModule.conditions),
    summary: asString(description.briefSummary) ?? "",
    studyType: asString(design.studyType) ?? "",
    enrollment: asCount(enrollmentInfo.count),
    startDate: asDate(moduleOf(statusModule, "startDateStruct").date),
    completionDate: asDate(moduleOf(statusModule, "completionDateStruct").date),
    firstSubmitDate: asDate(statusModule.studyFirstSubmitDate),
    url: `${CLINICAL_TRIALS_STUDY_BASE_URL}/${nctId}`,
  };
}

/** Parse a v2 `studies` response payload into a capped page. Pure: no network. */
export function parseClinicalTrialsPage(
  payload: unknown,
  cap = TRIALS_DISPLAY_CAP,
): ClinicalTrialsPage {
  const record = (payload && typeof payload === "object" ? payload : {}) as Record<
    string,
    unknown
  >;
  const studies = Array.isArray(record.studies) ? record.studies : [];
  const trials: ClinicalTrial[] = [];
  for (const raw of studies) {
    const trial = parseClinicalTrial(raw);
    if (!trial) continue;
    trials.push(trial);
    if (trials.length >= cap) break;
  }
  const total =
    typeof record.totalCount === "number" && Number.isFinite(record.totalCount)
      ? record.totalCount
      : trials.length;
  return { trials, total };
}

export interface StudiesQuery {
  /** Free-text search (`query.term`). */
  term?: string;
  /** Sponsor/company filter (`query.spons`). */
  sponsor?: string;
  pageSize?: number;
}

/** Build the v2 studies URL. Pure: no network, no API key. */
export function buildStudiesUrl(query: StudiesQuery = {}): string {
  const params = new URLSearchParams();
  params.set("format", "json");
  params.set("pageSize", String(query.pageSize ?? DEFAULT_PAGE_SIZE));
  const term = query.term?.trim();
  if (term) params.set("query.term", term);
  const sponsor = query.sponsor?.trim();
  if (sponsor) params.set("query.spons", sponsor);
  return `${CLINICAL_TRIALS_API_BASE_URL}/studies?${params.toString()}`;
}

export class ClinicalTrialsClient {
  /**
   * Search studies on ClinicalTrials.gov v2. No API key required.
   * The pane passes its search box as `term`; callers tracking one
   * company pass `sponsor` (mapped to `query.spons`).
   */
  async listTrials(
    query: { term?: string; sponsor?: string; pageSize?: number },
    signal?: AbortSignal,
  ): Promise<ClinicalTrialsPage> {
    return withConnectionRequest(CLINICAL_TRIALS_CONNECTION_ID, "fetch", async () => {
      const response = await trialsFetch.fetch(buildStudiesUrl(query), { signal });
      if (!response.ok) {
        throw new Error(
          `ClinicalTrials.gov request failed: ${response.status} ${response.statusText}`,
        );
      }
      return parseClinicalTrialsPage((await response.json()) as unknown);
    });
  }
}
