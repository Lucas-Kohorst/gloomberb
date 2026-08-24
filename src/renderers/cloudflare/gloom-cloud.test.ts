import { describe, expect, test } from "bun:test";
import { gloomCloudProxyUpstreamPath } from "./gloom-cloud";

describe("gloomCloudProxyUpstreamPath", () => {
  test("keeps /cloud/econ/calendar as the Gloom Cloud calendar route", () => {
    expect(gloomCloudProxyUpstreamPath("/cloud/econ/calendar")).toBe("/cloud/econ/calendar");
  });

  test("strips the extra hosted /cloud prefix from /cloud/cloud/econ/calendar", () => {
    expect(gloomCloudProxyUpstreamPath("/cloud/cloud/econ/calendar")).toBe("/cloud/econ/calendar");
  });

  test("strips once for auth and sync paths that are not under /cloud on the API", () => {
    expect(gloomCloudProxyUpstreamPath("/cloud/auth/sign-in/email")).toBe("/auth/sign-in/email");
    expect(gloomCloudProxyUpstreamPath("/cloud/sync/snapshot")).toBe("/sync/snapshot");
  });

  test("preserves query strings on FRED series", () => {
    expect(gloomCloudProxyUpstreamPath("/cloud/econ/series/DGS10", "?limit=5")).toBe(
      "/cloud/econ/series/DGS10?limit=5",
    );
  });

  test("keeps /cloud/logos/ticker/AAPL as the Gloom Cloud logo route", () => {
    expect(gloomCloudProxyUpstreamPath("/cloud/logos/ticker/AAPL")).toBe("/cloud/logos/ticker/AAPL");
  });

  test("strips the extra hosted /cloud prefix from /cloud/cloud/logos/crypto/BTC", () => {
    expect(gloomCloudProxyUpstreamPath("/cloud/cloud/logos/crypto/BTC")).toBe("/cloud/logos/crypto/BTC");
  });

  test("strips once for research paths that are not under /cloud on the API", () => {
    expect(gloomCloudProxyUpstreamPath("/cloud/research/equity-diagnostic")).toBe(
      "/research/equity-diagnostic",
    );
  });
});
