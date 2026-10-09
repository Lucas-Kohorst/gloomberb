import type { GloomPlugin } from "../../../types/plugin";
import { loanSurveyHeadless } from "./headless";
import { LoanSurveyPane } from "./pane";

export const loanSurveyPlugin: GloomPlugin = {
  id: "loan-survey",
  name: "Loan Officer Survey",
  version: "1.0.0",
  description: "Net percent of domestic banks tightening standards on business and consumer loans.",
  toggleable: true,

  // Public CSV over HTTPS, so every renderer. The host is declared so the web app proxies it.
  targets: ["cli", "tui", "desktop", "web"],
  hosts: ["fred.stlouisfed.org"],

  panes: [
    {
      id: "loan-survey",
      name: "Loan Officer Survey",
      icon: "L",
      component: LoanSurveyPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 78, height: 24 },
      tableExport: true,
      headless: loanSurveyHeadless,
    },
  ],

  paneTemplates: [
    {
      id: "loan-survey-pane",
      paneId: "loan-survey",
      label: "Loan Officer Survey",
      description: "Net percent of banks tightening standards for large-firm C&I loans and credit cards.",
      keywords: ["sloo", "sloos", "loan officer", "lending standards", "tightening", "credit", "c&i"],
      shortcut: { prefix: "SLOO" },
      headless: loanSurveyHeadless,
      createInstance: () => ({ placement: "floating" }),
    },
  ],
};
