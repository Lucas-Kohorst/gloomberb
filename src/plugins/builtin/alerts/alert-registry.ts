import type { CreateAlertOptions } from "../../../types/plugin";

/**
 * Module-level alert handler set by the alerts plugin in `setup()`.
 * Other plugins call `createAlert()` to add alerts without importing the
 * alerts plugin directly — same pattern as `registerConnectionSource`.
 */

let alertHandler: ((options: CreateAlertOptions) => void) | null = null;

export function setAlertHandler(handler: ((options: CreateAlertOptions) => void) | null): void {
  alertHandler = handler;
}

export function createAlert(options: CreateAlertOptions): void {
  alertHandler?.(options);
}
