export const CRT_SH_PLUGIN_ID = "crt-sh";
export const CRT_SH_CONNECTION_ID = "crt-sh";
export const CRT_SH_API_BASE_URL = "https://crt.sh";

export interface CertificateRecord {
  id: number;
  issuerName: string;
  commonName: string;
  nameValues: string[];
  entryTimestamp: Date;
  notBefore: Date;
  notAfter: Date;
  serialNumber: string;
}

export interface CertSearchPage {
  records: CertificateRecord[];
  total: number;
  uniqueDomains: string[];
}
