export const FEDERAL_REGISTER_PLUGIN_ID = "federal-register";
export const FEDERAL_REGISTER_CONNECTION_ID = "federal-register";
export const FEDERAL_REGISTER_API_BASE_URL = "https://www.federalregister.gov/api/v1";

export interface FedRegisterDoc {
  documentNumber: string;
  title: string;
  type: string;
  publicationDate: Date;
  agencies: string[];
  abstract: string;
  htmlUrl: string;
  pdfUrl: string;
  regulatoryIdNumber: string;
  significant: boolean;
  commentsCloseDate: Date | null;
}

export interface FedRegisterPage {
  documents: FedRegisterDoc[];
  total: number;
  hasNext: boolean;
}

export interface FedRegisterDetail {
  doc: FedRegisterDoc;
  bodyHtml: string;
  sourceUrl: string;
}
