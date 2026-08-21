import type { DataProvider, MarketDataRequestContext, QuoteSubscriptionTarget } from "../../types/data-provider";
import type { Quote } from "../../types/financials";
import type { BrokerCandidate } from "./brokers";
import { isProviderQuoteUsableForCurrentSession } from "./financials";

export interface ProviderRouterStreamingDeps {
  providersInPriorityOrder(): DataProvider[];
  getBrokerCandidatesForContext(context?: MarketDataRequestContext, includeFallbackInstances?: boolean): BrokerCandidate[];
  hasBrokerContext(context?: MarketDataRequestContext): boolean;
  brokerSourceKey(candidate: BrokerCandidate): string;
  logInfo(message: string, data?: unknown): void;
  logWarn(message: string, data?: unknown): void;
}

export class ProviderRouterStreamingRoutes {
  constructor(private readonly deps: ProviderRouterStreamingDeps) {}

  subscribeQuotes(
    targets: QuoteSubscriptionTarget[],
    onQuote: (target: QuoteSubscriptionTarget, quote: Quote) => void,
  ): () => void {
    const streamingProviders = this.deps.providersInPriorityOrder().filter((provider) => typeof provider.subscribeQuotes === "function");
    const streamingProvider = streamingProviders[0] ?? null;
    const brokerGroups = new Map<string, { candidate: BrokerCandidate; targets: QuoteSubscriptionTarget[] }>();
    const providerTargets: QuoteSubscriptionTarget[] = [];
    const addBrokerTarget = (brokerCandidate: BrokerCandidate, target: QuoteSubscriptionTarget) => {
      const key = this.deps.brokerSourceKey(brokerCandidate);
      const group = brokerGroups.get(key) ?? { candidate: brokerCandidate, targets: [] };
      group.targets.push(target);
      brokerGroups.set(key, group);
    };

    for (const target of targets) {
      if (target.route === "provider") {
        const brokerCandidate = this.getStreamingBrokerCandidate(target);
        if (streamingProvider) {
          providerTargets.push(target);
        } else if (brokerCandidate) {
          addBrokerTarget(brokerCandidate, target);
        }
        continue;
      }
      const brokerCandidate = this.getStreamingBrokerCandidate(target);
      if (target.route === "broker" && brokerCandidate) {
        addBrokerTarget(brokerCandidate, target);
        continue;
      }
      if (!brokerCandidate || streamingProvider) {
        providerTargets.push(target);
        continue;
      }

      addBrokerTarget(brokerCandidate, target);
    }

    const unsubscribers: Array<() => void> = [];

    for (const { candidate, targets: brokerTargets } of brokerGroups.values()) {
      this.deps.logInfo("Delegating broker quote stream", {
        brokerId: candidate.brokerId,
        brokerInstanceId: candidate.brokerInstanceId,
        targetCount: brokerTargets.length,
      });
      unsubscribers.push(candidate.broker.subscribeQuotes!(candidate.instance, brokerTargets, onQuote));
    }

    if (providerTargets.length > 0 && streamingProviders.length > 0) {
      for (const provider of streamingProviders) {
        this.deps.logInfo("Delegating provider quote stream", {
          providerId: provider.id,
          targetCount: providerTargets.length,
        });
        unsubscribers.push(provider.subscribeQuotes!(providerTargets, (target, quote) => {
          if (isProviderQuoteUsableForCurrentSession(quote, target.exchange)) {
            onQuote(target, quote);
          }
        }));
      }
    }

    if (unsubscribers.length === 0) {
      this.deps.logWarn("No provider supports quote streaming", {
        targetCount: targets.length,
      });
      return () => {};
    }

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }

  private getStreamingBrokerCandidate(target: QuoteSubscriptionTarget): BrokerCandidate | null {
    if (!this.deps.hasBrokerContext(target.context)) return null;
    return this.deps.getBrokerCandidatesForContext(target.context, false)
      .find((candidate) => typeof candidate.broker.subscribeQuotes === "function") ?? null;
  }
}
