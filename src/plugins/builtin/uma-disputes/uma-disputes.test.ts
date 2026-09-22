import { createHash, createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { disputesFromPages, disputeStage, disputeTxUrl, parseUmaQuestion, parseUmaRecentPage } from "./parse";
import { canonicalPath, hmacSha256Hex } from "./sign";
import { resolveBravadoCredentials } from "./client";
import type { UmaQuestion } from "./types";

const EMPTY_BODY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("Bravado HMAC", () => {
  test("sorts query keys and percent-encodes values", () => {
    expect(canonicalPath("/uma/recent", { stage: "disputed", limit: 100 })).toBe(
      "/uma/recent?limit=100&stage=disputed",
    );
    expect(canonicalPath("/uma/question", { id: "0xabc def" })).toBe(
      "/uma/question?id=0xabc%20def",
    );
  });

  test("signs the documented four-line payload", async () => {
    const path = canonicalPath("/uma/recent", { stage: "disputed", limit: 2 });
    const timestamp = "1700000000000";
    const payload = [timestamp, "GET", path, EMPTY_BODY_HASH].join("\n");
    const expected = createHmac("sha256", "secret").update(payload).digest("hex");
    expect(createHash("sha256").update("").digest("hex")).toBe(EMPTY_BODY_HASH);
    expect(await hmacSha256Hex("secret", payload)).toBe(expected);
    expect(payload.endsWith("\n")).toBe(false);
  });
});

describe("UMA dispute records", () => {
  test("reads the documented question shape and recent wrapper", () => {
    const page = parseUmaRecentPage({
      count: 1,
      questions: [{
        question_id: "0x3281d5f64c96c007212bdc90b29cb51581058dac59a57fc2b98a31fd7abe0538",
        condition_id: "0x19c79788f1288b497b5305f81b71c3f20db1ae338b049d733dcb09b5d5d352f6",
        title: "Will Ben Shelton win the 2026 Men's US Open?",
        answer: "no",
        settled: true,
        proposed: {
          proposer: "0xef3990a7c8fa92d84dce0e7816ca3410820c1d36",
          answer: "no",
          price_raw: "0x0",
          request_ts: 1767385181,
          block: 93012001,
          tx: "0x42879bd3",
          log_index: 5,
        },
        settled_at: {
          answer: "no",
          price_raw: "0x0",
          payout: "500800000",
          request_ts: 1767385181,
          block: 93012040,
          tx: "0x7c80413d",
          log_index: 9,
        },
        updated_ms: 1789253500123,
      }],
    });
    expect(page.count).toBe(1);
    expect(page.questions[0]?.settled).toBe(true);
    expect(page.questions[0]?.settledAt?.payout).toBe("500800000");
    expect(disputeStage(page.questions[0]!)).toBeNull();
  });

  test("keeps open disputes and settled questions that were disputed", () => {
    const disputed = parseUmaQuestion({
      question_id: "0x1111111111111111111111111111111111111111111111111111111111111111",
      condition_id: "0x2222222222222222222222222222222222222222222222222222222222222222",
      title: "Will the proposal be challenged?",
      answer: "yes",
      settled: false,
      proposed: { proposer: "0xaaa", answer: "no", tx: `0x${"ab".repeat(32)}` },
      disputed: {
        disputer: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        answer: "yes",
        tx: `0x${"cd".repeat(32)}`,
        seen_pending: true,
      },
      updated_ms: 10,
    }, true);
    const settledDispute = parseUmaQuestion({
      question_id: "0x3333333333333333333333333333333333333333333333333333333333333333",
      title: "Settled after a dispute",
      answer: "no",
      settled: true,
      disputed: { disputer: "0xccc", answer: "no" },
      settled_at: { payout: "1", answer: "no" },
      updated_ms: 20,
    });
    const undisputed = parseUmaQuestion({
      question_id: "0x4444444444444444444444444444444444444444444444444444444444444444",
      title: "Undisputed settlement",
      answer: "yes",
      settled: true,
      settled_at: { payout: "2" },
      updated_ms: 30,
    });
    expect(disputed && disputeStage(disputed)).toBe("pending");
    expect(settledDispute && disputeStage(settledDispute)).toBe("settled");
    const rows = disputesFromPages([disputed, settledDispute, undisputed].filter((row): row is UmaQuestion => !!row));
    expect(rows.map((row) => row.questionId)).toEqual([
      settledDispute!.questionId,
      disputed!.questionId,
    ]);
    expect(disputeTxUrl(disputed!)).toBe(`https://polygonscan.com/tx/0x${"cd".repeat(32)}`);
  });

  test("drops questions with no id", () => {
    expect(parseUmaQuestion({ title: "missing id" })).toBeNull();
    expect(parseUmaRecentPage({ questions: "nope" }).questions).toEqual([]);
  });
});

describe("Bravado credentials", () => {
  test("reads a second-line secret, then the env pair", () => {
    expect(resolveBravadoCredentials("pub", "secret")).toEqual({ apiKey: "pub", apiSecret: "secret" });
    expect(resolveBravadoCredentials("pub\nsecret")).toEqual({ apiKey: "pub", apiSecret: "secret" });
    const previousKey = process.env.BRAVADO_API_KEY;
    const previousSecret = process.env.BRAVADO_API_SECRET;
    process.env.BRAVADO_API_KEY = "env-key";
    process.env.BRAVADO_API_SECRET = "env-secret";
    try {
      expect(resolveBravadoCredentials("stored-key")).toEqual({
        apiKey: "stored-key",
        apiSecret: "env-secret",
      });
      expect(resolveBravadoCredentials(undefined)).toEqual({
        apiKey: "env-key",
        apiSecret: "env-secret",
      });
    } finally {
      if (previousKey === undefined) delete process.env.BRAVADO_API_KEY;
      else process.env.BRAVADO_API_KEY = previousKey;
      if (previousSecret === undefined) delete process.env.BRAVADO_API_SECRET;
      else process.env.BRAVADO_API_SECRET = previousSecret;
    }
  });
});
