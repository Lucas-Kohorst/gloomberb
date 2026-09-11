export const OPEN_CORPORATES_PLUGIN_ID = "open-corporates";
export const OPEN_CORPORATES_CONNECTION_ID = "open-corporates";
export const OPEN_CORPORATES_API_BASE_URL = "https://api.opencorporates.com/v0.4";

/** A company record from the OpenCorporates search/detail API. */
export interface OpenCorporatesCompany {
  id: string;
  name: string;
  companyNumber: string;
  jurisdictionCode: string;
  companyType: string;
  incorporationDate: Date;
  currentStatus: string;
  inactive: boolean;
  registeredAddress: string;
  opencorporatesUrl: string;
}

/** An officer attached to a company detail record. */
export interface OpenCorporatesOfficer {
  name: string;
  position: string;
  startDate: string;
  endDate: string;
}

/** A company plus its officers, from the company detail endpoint. */
export interface OpenCorporatesCompanyDetail extends OpenCorporatesCompany {
  officers: OpenCorporatesOfficer[];
}

/** A page of company search results. */
export interface OpenCorporatesPage {
  companies: OpenCorporatesCompany[];
  total: number;
}
