import type { BrokerInstanceConfig } from "../../types/config";
import {
  ROBINHOOD_CONNECTION_MODE,
  ROBINHOOD_CONNECTION_OPTION,
} from "../../shared/robinhood-oauth";

export {
  ROBINHOOD_CONNECTION_MODE,
  ROBINHOOD_CONNECTION_OPTION,
} from "../../shared/robinhood-oauth";

export function robinhoodConnectionMode(instance: BrokerInstanceConfig): string {
  const fromConfig = instance.config?.connectionMode;
  if (typeof fromConfig === "string" && fromConfig.trim()) return fromConfig;
  if (typeof instance.connectionMode === "string" && instance.connectionMode.trim()) {
    return instance.connectionMode;
  }
  return ROBINHOOD_CONNECTION_MODE;
}

/** OAuth is the only Robinhood mode; missing config still means sign-in is ready. */
export function isRobinhoodOAuthConfigured(instance: BrokerInstanceConfig): boolean {
  return robinhoodConnectionMode(instance) === ROBINHOOD_CONNECTION_MODE;
}

export function robinhoodConfigSchema() {
  return [{
    key: "connectionMode",
    label: "Connection",
    type: "select" as const,
    required: true,
    defaultValue: ROBINHOOD_CONNECTION_MODE,
    options: [{
      label: ROBINHOOD_CONNECTION_OPTION.label,
      value: ROBINHOOD_CONNECTION_OPTION.value,
      description: ROBINHOOD_CONNECTION_OPTION.description,
    }],
  }];
}
