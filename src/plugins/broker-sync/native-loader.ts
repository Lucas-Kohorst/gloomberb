import type { BrokerAdapter } from "../../types/broker";
import type { BrokerInstanceConfig } from "../../types/config";
import type { BrokerPortfolioSnapshot } from "./normalize";

export type RobinhoodNativeModule = {
  loadRobinhoodPortfolio(instance: BrokerInstanceConfig): Promise<BrokerPortfolioSnapshot>;
  robinhoodBroker: BrokerAdapter;
};

export function loadRobinhoodNativeModule(): Promise<RobinhoodNativeModule> {
  return import("./robinhood-native");
}
