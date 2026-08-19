export const NWS_CLI_PROVIDER_ID = "nws-cli";
export const NWS_CLI_USER_AGENT =
  "Gloomberb (https://terminal.kohor.st; nws-cli@kohor.st)";

export type NwsCliPrintKind = "final" | "preliminary";

/** First-final NWS Daily Climate Report (CLI) keyed by ICAO station. */
export interface NwsCliPrint {
  provider: typeof NWS_CLI_PROVIDER_ID;
  seriesId: string;
  icao: string;
  cliProduct: string;
  date: string;
  issuedAt: string | null;
  printKind: NwsCliPrintKind;
  highF: number | null;
  lowF: number | null;
  precipIn: number | null;
  productId: string | null;
  sourceUrl: string | null;
}

export interface NwsCliPrintSet {
  provider: typeof NWS_CLI_PROVIDER_ID;
  seriesId: string;
  icao: string;
  prints: NwsCliPrint[];
}
