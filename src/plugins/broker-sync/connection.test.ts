import { describe, expect, test } from "bun:test";
import { robinhoodClientMetadata } from "../../shared/robinhood-oauth";
import { robinhoodBroker } from "./robinhood";
import { isRobinhoodOAuthConfigured, robinhoodConfigSchema } from "./connection";

describe("Robinhood connection mode", () => {
  test("treats missing connectionMode as connectable oauth", async () => {
    const instance = {
      id: "rh-1",
      brokerType: "robinhood",
      label: "Robinhood",
      config: {},
      enabled: true,
    };
    expect(isRobinhoodOAuthConfigured(instance)).toBe(true);
    expect(await robinhoodBroker.validate(instance)).toBe(true);
  });

  test("accepts oauth on either the instance or config field", async () => {
    expect(await robinhoodBroker.validate({
      id: "rh-1",
      brokerType: "robinhood",
      label: "Robinhood",
      connectionMode: "oauth",
      config: {},
    })).toBe(true);
    expect(await robinhoodBroker.validate({
      id: "rh-1",
      brokerType: "robinhood",
      label: "Robinhood",
      config: { connectionMode: "oauth" },
    })).toBe(true);
  });

  test("rejects an unknown connection kind", async () => {
    expect(await robinhoodBroker.validate({
      id: "rh-1",
      brokerType: "robinhood",
      label: "Robinhood",
      config: { connectionMode: "gateway" },
    })).toBe(false);
  });

  test("copy and OAuth metadata match read-all plus Agentic trading", () => {
    const field = robinhoodConfigSchema()[0];
    expect(field?.options?.[0]?.label).toContain("trade Agentic");
    expect(field?.options?.[0]?.description).toContain("Agentic");
    const metadata = robinhoodClientMetadata("https://terminal.kohor.st/api/oauth/robinhood/callback");
    expect(metadata.token_endpoint_auth_method).toBe("none");
    expect(metadata.scope).toBe("internal");
    expect(metadata.redirect_uris).toEqual(["https://terminal.kohor.st/api/oauth/robinhood/callback"]);
    expect(metadata).not.toHaveProperty("client_secret");
  });
});
