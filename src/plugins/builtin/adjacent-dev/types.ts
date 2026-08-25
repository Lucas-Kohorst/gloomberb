export const ADJACENT_DEV_PLUGIN_ID = "adjacent-dev";
export const ADJACENT_DEV_API_KEY_CONFIG = "adjacentDevApiKey";
export const ADJACENT_DEV_CONNECTION_ID = "adjacent-dev";

/** Base URL for the dev filings API. */
export const ADJACENT_DEV_BASE_URL = "https://api.dev.adjacent.markets";

/**
 * The public twin covers the last 90 days and needs no key; the authenticated
 * catalog goes back further and needs `org:filings:read`. Both return the same
 * row shape, so the pane only has to pick a prefix.
 */
export const ADJACENT_DEV_AUTH_PREFIX = "api/v1";
export const ADJACENT_DEV_PUBLIC_PREFIX = "api/v1/public";

/** CFTC industry-filing feeds carried by the API. */
export type CftcFeed = "ptc_dcm_rules" | "dcm_products" | "dco" | "dco_rules";

export const CFTC_FEED_LABELS: Record<CftcFeed, string> = {
  ptc_dcm_rules: "PTC/DCM Rules",
  dcm_products: "DCM Products",
  dco: "DCO",
  dco_rules: "DCO Rules",
};

/**
 * One CFTC industry filing.
 *
 * Most fields are feed-dependent: the rules feeds carry `description` and
 * `receiptDate`, DCM product rows carry `productName`/`category`, and DCO rows
 * carry `remarks`. `title` is always populated, so render it rather than
 * picking between the feed-specific columns.
 */
export interface CftcFiling {
  id: number;
  title: string;
  feed: CftcFeed;
  orgCode: string;
  status: string;
  statusDate: Date;
  docCount: number;
  description?: string;
  productName?: string;
  productType?: string;
  category?: string;
  subcategory?: string;
  productsAffected?: string;
  remarks?: string;
  receiptDate?: Date;
  /** Business-day estimate; only present while a rules filing is pending. */
  predictedEffectiveDate?: Date;
  firstSeenAt?: Date;
  lastSeenAt?: Date;
}

/** An attachment on a CFTC filing. */
export interface CftcFilingDocument {
  url: string;
  title: string;
}

/** A filing plus its converted attachment text. */
export interface CftcFilingDetail {
  filing: CftcFiling;
  markdown: string;
  documents: CftcFilingDocument[];
  sourceUrl: string;
}

/** Distinct filter values present in the catalog. */
export interface CftcFilingFilters {
  feeds: string[];
  orgs: string[];
  statuses: string[];
}

export interface CftcPageMeta {
  /** null on uncounted lists; page using `hasNext` instead. */
  total: number | null;
  page: number;
  perPage: number;
  totalPages: number | null;
  hasNext: boolean;
  hasPrev: boolean;
  /** True when `total` is the server's counting ceiling, not an exact count. */
  totalCapped?: boolean;
}

export interface CftcFilingsPage {
  filings: CftcFiling[];
  meta: CftcPageMeta;
}

/** Query options for the filings list. */
export interface CftcFilingsQuery {
  feed?: CftcFeed;
  org?: string;
  status?: string;
  /** Lexical filter over organization, description, product name, or id. */
  q?: string;
  page?: number;
  perPage?: number;
}
