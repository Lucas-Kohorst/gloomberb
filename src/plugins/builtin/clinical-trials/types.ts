export const CLINICAL_TRIALS_PLUGIN_ID = "clinical-trials";
export const CLINICAL_TRIALS_CONNECTION_ID = "clinical-trials";
export const CLINICAL_TRIALS_API_BASE_URL = "https://clinicaltrials.gov/api/v2";
export const CLINICAL_TRIALS_STUDY_BASE_URL = "https://clinicaltrials.gov/study";

/** A single clinical study from the ClinicalTrials.gov API v2. */
export interface ClinicalTrial {
  /** NCT identifier, e.g. "NCT05123456". */
  nctId: string;
  /** Brief title shown in the table. */
  title: string;
  officialTitle: string;
  /** Raw overall status, e.g. "RECRUITING". */
  status: string;
  /** Raw phase codes, e.g. ["PHASE3"]. */
  phases: string[];
  /** Lead sponsor name. */
  sponsor: string;
  /** Lead sponsor class, e.g. "INDUSTRY". */
  sponsorClass: string;
  conditions: string[];
  summary: string;
  studyType: string;
  enrollment: number | null;
  startDate: Date | null;
  completionDate: Date | null;
  firstSubmitDate: Date | null;
  /** Deep link to the study page for [o]pen. */
  url: string;
}

/** A page of clinical trial results. */
export interface ClinicalTrialsPage {
  trials: ClinicalTrial[];
  total: number;
}
