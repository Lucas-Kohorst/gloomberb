export interface EsgScores {
  totalEsg: number | null;
  environmentScore: number | null;
  socialScore: number | null;
  governanceScore: number | null;
  /** Yahoo's performance band relative to peers (e.g. "OUT_PERFORM", "IN_LINE", "UNDER_PERFORM"). */
  esgPerformance: string | null;
  /** Number of peers in the comparison group. */
  peerCount: number | null;
  /** Sector or industry peer-group label. */
  peerGroup: string | null;
  /** Peer/sector average total ESG score. */
  peerEsgScore: number | null;
  peerEnvironmentScore: number | null;
  peerSocialScore: number | null;
  peerGovernanceScore: number | null;
  /** Controversy band (e.g. "LOW", "MODERATE", "HIGH", "SEVERE"). */
  controversyLevel: string | null;
  /** Numeric controversy score (lower is better). */
  controversyScore: number | null;
  ratingMonth: number | null;
  ratingYear: number | null;
}

/**
 * Carbon / climate emissions data. Yahoo Finance does not expose Scope 1/2/3
 * emissions through the quoteSummary API, so these fields are nullable and
 * populated only when a carbon data source is wired in (see client.ts TODO).
 */
export interface CarbonEmissions {
  /** Direct emissions from owned/controlled sources (tonnes CO2e). */
  scope1: number | null;
  /** Indirect emissions from purchased energy (tonnes CO2e). */
  scope2: number | null;
  /** All other indirect emissions in the value chain (tonnes CO2e). */
  scope3: number | null;
  /** Total emissions across all scopes (tonnes CO2e). */
  totalEmissions: number | null;
  /** Reporting year for the emissions data. */
  reportingYear: number | null;
}

export interface EsgData {
  symbol: string;
  scores: EsgScores;
  carbon: CarbonEmissions | null;
  /** External URL for the ESG profile on the data provider's site. */
  sourceUrl: string | null;
}

export type LoadStatus = "idle" | "loading" | "loaded" | "error";
