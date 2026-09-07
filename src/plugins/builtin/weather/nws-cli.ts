/**
 * NWS Daily Climate Report (CLI) plugin entry.
 *
 * Thin wrapper over HEAD's {@link ./nws-client} and `src/sources/nws-cli`.
 * The shared source owns parsing and fetch; do not reimplement the CLI client here.
 */

import {
  cliProductCodeForIcao,
  firstFinalCliPrint,
  normalizeIcaoStation,
  parseNwsCliProductText,
} from "../../../sources/nws-cli/parse";
import { NWS_CLI_USER_AGENT } from "../../../sources/nws-cli/types";
import { fetchNwsCliHistory, loadNwsCliSeries, nwsIcaoForStation } from "./nws-client";
import { NWS_CLI_CONNECTION_ID } from "./types";

export {
  NWS_CLI_CONNECTION_ID,
  NWS_CLI_USER_AGENT,
  cliProductCodeForIcao,
  fetchNwsCliHistory,
  loadNwsCliSeries,
  normalizeIcaoStation,
  nwsIcaoForStation,
  parseNwsCliProductText,
};
export const firstFinalPrint = firstFinalCliPrint;

/** Parse high/low/precip out of a raw NWS CLI product text. */
export function parseNwsCliText(text: string, icao: string) {
  return parseNwsCliProductText(text, { icao });
}

/**
 * Fetch NWS CLI prints for an ICAO station. With `date`, returns matching
 * prints for that climate day; otherwise up to `days` of history.
 */
export async function fetchNwsCliPrint(icao: string, date?: string, days?: number) {
  const prints = await fetchNwsCliHistory(icao, days);
  return date ? prints.filter((print) => print.date === date) : prints;
}
