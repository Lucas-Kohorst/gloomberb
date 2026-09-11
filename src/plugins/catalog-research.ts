import type { GloomPlugin } from "../types/plugin";
import { cboeBookPlugin } from "./builtin/cboe-book";
import { cfpbComplaintsPlugin } from "./builtin/cfpb-complaints";
import { clinicalTrialsPlugin } from "./builtin/clinical-trials";
import { commentLettersPlugin } from "./builtin/comment-letters";
import { courtListenerPlugin } from "./builtin/courtlistener";
import { eiaEnergyPlugin } from "./builtin/eia-energy";
import { fdicBankPlugin } from "./builtin/fdic-bank";
import { filingDiffPlugin } from "./builtin/filing-diff";
import { foiaLogsPlugin } from "./builtin/foia-logs";
import { googleBooksPlugin } from "./builtin/google-books";
import { iborrowDeskPlugin } from "./builtin/iborrowdesk";
import { levelsFyiPlugin } from "./builtin/levels-fyi";
import { openCorporatesPlugin } from "./builtin/open-corporates";
import { openPaymentsPlugin } from "./builtin/open-payments";
import { openFdaPlugin } from "./builtin/openfda";
import { sec8KAlertsPlugin } from "./builtin/sec-8k-alerts";
import { secFtsPlugin } from "./builtin/sec-fts";
import { shortCampaignsPlugin } from "./builtin/short-campaigns";
import { workplaceSignalsPlugin } from "./builtin/workplace-signals";

export const researchDataPlugins: readonly GloomPlugin[] = [
  cboeBookPlugin,
  cfpbComplaintsPlugin,
  clinicalTrialsPlugin,
  commentLettersPlugin,
  courtListenerPlugin,
  eiaEnergyPlugin,
  fdicBankPlugin,
  filingDiffPlugin,
  foiaLogsPlugin,
  googleBooksPlugin,
  iborrowDeskPlugin,
  levelsFyiPlugin,
  openCorporatesPlugin,
  openPaymentsPlugin,
  openFdaPlugin,
  sec8KAlertsPlugin,
  secFtsPlugin,
  shortCampaignsPlugin,
  workplaceSignalsPlugin,
];
