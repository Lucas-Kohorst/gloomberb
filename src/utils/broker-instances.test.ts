import { describe, expect, test } from "bun:test";
import type { BrokerInstanceConfig } from "../types/config";
import {
  findReusableBrokerInstance,
  parseBrokerPortfolioId,
  resolvePortfolioBrokerInstanceId,
} from "./broker-instances";

function instance(patch: Partial<BrokerInstanceConfig> & { id: string }): BrokerInstanceConfig {
  return { brokerType: "robinhood", label: "Robinhood", config: {}, ...patch };
}

describe("parseBrokerPortfolioId", () => {
  test("splits on the last separator so instance suffixes survive", () => {
    expect(parseBrokerPortfolioId("broker:ibkr-interactive-brokers-9:U12856342")).toEqual({
      brokerInstanceId: "ibkr-interactive-brokers-9",
      accountId: "U12856342",
    });
  });

  test("rejects ids that carry no account segment", () => {
    expect(parseBrokerPortfolioId("main")).toBeNull();
    expect(parseBrokerPortfolioId("broker:robinhood")).toBeNull();
    expect(parseBrokerPortfolioId("broker:robinhood:")).toBeNull();
    expect(parseBrokerPortfolioId("broker::DU1")).toBeNull();
  });
});

describe("resolvePortfolioBrokerInstanceId", () => {
  test("falls back to the id when the link was stripped in transit", () => {
    expect(resolvePortfolioBrokerInstanceId({ id: "broker:demo-live:DU1" })).toBe("demo-live");
    expect(resolvePortfolioBrokerInstanceId({ id: "broker:demo-live:DU1", brokerInstanceId: "other" }))
      .toBe("other");
    expect(resolvePortfolioBrokerInstanceId({ id: "main" })).toBeNull();
  });
});

describe("findReusableBrokerInstance", () => {
  test("does not reuse on a label collision without a confirmable account identity", () => {
    const instances = [instance({ id: "robinhood-robinhood" }), instance({ id: "ibkr-ib", brokerType: "ibkr" })];

    // No account subject available — a label collision must fork, not overwrite.
    expect(findReusableBrokerInstance(instances, "robinhood", "Robinhood")).toBeUndefined();
    expect(findReusableBrokerInstance(instances, "robinhood", "robinhood")).toBeUndefined();
    expect(findReusableBrokerInstance(instances, "ibkr", "Robinhood")).toBeUndefined();
    expect(findReusableBrokerInstance(instances, "robinhood", "Second Account")).toBeUndefined();
  });

  test("reuses the profile when a stable account subject confirms the same account", () => {
    const instances = [
      instance({ id: "robinhood-robinhood", config: { accountSubject: "acct-abc" } }),
      instance({ id: "robinhood-robinhood-2", config: { accountSubject: "acct-xyz" } }),
    ];

    expect(findReusableBrokerInstance(instances, "robinhood", "Robinhood", { accountSubject: "acct-abc" })?.id)
      .toBe("robinhood-robinhood");
    expect(findReusableBrokerInstance(instances, "robinhood", "Robinhood", { accountSubject: "acct-xyz" })?.id)
      .toBe("robinhood-robinhood-2");
    // No match for an unknown account subject — fork.
    expect(findReusableBrokerInstance(instances, "robinhood", "Robinhood", { accountSubject: "acct-unknown" }))
      .toBeUndefined();
  });

  test("reuses the profile when the same account is re-added so its portfolios are not stranded", () => {
    const instances = [instance({ id: "robinhood-robinhood", config: { username: "me@example.com" } })];

    expect(
      findReusableBrokerInstance(instances, "robinhood", "Robinhood", { username: "me@example.com" })?.id,
    ).toBe("robinhood-robinhood");
  });

  test("still reuses when the stored profile gained tokens the new submission cannot know", () => {
    const instances = [
      instance({
        id: "robinhood-robinhood",
        config: { username: "me@example.com", oauth: { accessToken: "stored" } },
      }),
    ];

    // A fresh form submission has no OAuth bag; that absence is not a mismatch.
    expect(
      findReusableBrokerInstance(instances, "robinhood", "Robinhood", { username: "me@example.com" })?.id,
    ).toBe("robinhood-robinhood");
  });

  test("does not reuse when the submitted account differs under the same label", () => {
    const instances = [instance({ id: "robinhood-robinhood", config: { username: "first@example.com" } })];

    expect(
      findReusableBrokerInstance(instances, "robinhood", "Robinhood", { username: "second@example.com" }),
    ).toBeUndefined();
  });

  test("two distinct accounts sharing a label do not collapse", () => {
    const first = instance({
      id: "robinhood-robinhood",
      config: { oauth: { accessToken: "first-token" } },
    });
    const second = instance({
      id: "robinhood-robinhood-2",
      config: { oauth: { accessToken: "second-token" } },
    });
    const instances = [first, second];

    // Without a confirmable identity, neither account is reused — both survive.
    expect(findReusableBrokerInstance(instances, "robinhood", "Robinhood")).toBeUndefined();
    expect(instances).toHaveLength(2);
    expect(instances[0]!.config.oauth).toEqual({ accessToken: "first-token" });
    expect(instances[1]!.config.oauth).toEqual({ accessToken: "second-token" });
  });
});
