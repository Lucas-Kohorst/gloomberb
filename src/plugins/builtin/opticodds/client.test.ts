import { afterEach, describe, expect, test } from "bun:test";
import { setHttpFetchTransport } from "../../../utils/http-transport";
import { loadOpticOdds, setOpticOddsApiKeyResolver } from "./client";

afterEach(() => {
  setOpticOddsApiKeyResolver(() => undefined);
  setHttpFetchTransport(null);
});

describe("OpticOdds key resolution", () => {
  test("missing key points at Account Management instead of the old KEYS pane", async () => {
    delete process.env.OPTICODDS_API_KEY;
    setOpticOddsApiKeyResolver(() => undefined);
    await expect(loadOpticOdds("nfl")).rejects.toThrow(
      "OpticOdds API key missing. Add it in Account Management on the Keys tab.",
    );
  });

  test("sends the attached key and does not report it missing", async () => {
    const seen: string[] = [];
    setOpticOddsApiKeyResolver(() => "local-optic-key");
    setHttpFetchTransport(async (_url, init) => {
      seen.push(new Headers(init?.headers).get("X-Api-Key") ?? "");
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    await expect(loadOpticOdds("nfl")).resolves.toEqual([]);
    expect(seen).toEqual(["local-optic-key"]);
  });
});
