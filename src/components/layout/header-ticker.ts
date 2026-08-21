export const HEADER_COMMAND_BAR_PLACEHOLDER = "Command or plain English…";

/** Clicking the header control opens the real command bar, not ticker-only search. */
export function buildHeaderCommandBarOpenAction(): {
  type: "SET_COMMAND_BAR";
  open: true;
  query: "";
} {
  return { type: "SET_COMMAND_BAR", open: true, query: "" };
}
