import { afterEach, describe, expect, test } from "bun:test";
import { resolveCompanyLogoSrc } from "./company-logo";

type HostedFlag = { __GLOOM_CLOUD_HOSTED?: boolean };

function setHosted(hosted: boolean): void {
  const flag = globalThis as HostedFlag;
  if (hosted) flag.__GLOOM_CLOUD_HOSTED = true;
  else delete flag.__GLOOM_CLOUD_HOSTED;
}

afterEach(() => {
  setHosted(false);
});

describe("resolveCompanyLogoSrc", () => {
  test("builds a ticker logo URL", () => {
    expect(resolveCompanyLogoSrc({ symbol: "aapl", assetCategory: "STK" }))
      .toBe("https://api.gloom.sh/cloud/logos/ticker/AAPL");
  });

  test("maps crypto quote pairs onto the crypto path", () => {
    expect(resolveCompanyLogoSrc({ symbol: "btc-usd", assetCategory: "CRYPTO" }))
      .toBe("https://api.gloom.sh/cloud/logos/crypto/BTC");
  });

  test("skips cash and options", () => {
    expect(resolveCompanyLogoSrc({ symbol: "USD", assetCategory: "CASH" })).toBeNull();
    expect(resolveCompanyLogoSrc({ symbol: "AAPL  240119C00190000", assetCategory: "OPT" })).toBeNull();
  });

  test("uses a same-origin Cloud logo path on hosted web", () => {
    setHosted(true);
    expect(resolveCompanyLogoSrc({ symbol: "AAPL", assetCategory: "STK" }))
      .toBe("/cloud/logos/ticker/AAPL");
    expect(resolveCompanyLogoSrc({ symbol: "btc-usd", assetCategory: "CRYPTO" }))
      .toBe("/cloud/logos/crypto/BTC");
  });
});
