import { afterEach, expect, test } from "bun:test";
import {
  fetchJsonAuthenticated,
  setSubstackFetchTransportForTests,
} from "./store";

const auth = {
  email: "user@example.com",
  sid: "session-secret",
  lli: "1",
  loggedInAt: Date.now(),
};

afterEach(() => {
  setSubstackFetchTransportForTests(null);
});

test("does not attach session cookies to untrusted origins", async () => {
  const requests: string[] = [];
  setSubstackFetchTransportForTests(async (url) => {
    requests.push(url);
    return new Response("{}", { status: 200 });
  });

  await expect(fetchJsonAuthenticated("https://attacker.example/api", auth))
    .rejects.toThrow("untrusted origin");
  expect(requests).toEqual([]);
});

test("only sends session cookies to HTTPS Substack origins", async () => {
  const requests: Array<{ url: string; cookie: string | null }> = [];
  setSubstackFetchTransportForTests(async (url, init) => {
    requests.push({
      url,
      cookie: new Headers(init?.headers).get("cookie"),
    });
    return new Response("{}", { status: 200 });
  });

  await fetchJsonAuthenticated("https://substack.com/api/v1/posts/1", auth);
  await fetchJsonAuthenticated("https://publication.substack.com/api/v1/posts/1", auth);
  await expect(fetchJsonAuthenticated("http://substack.com/api/v1/posts/1", auth))
    .rejects.toThrow("untrusted origin");

  expect(requests).toEqual([
    {
      url: "https://substack.com/api/v1/posts/1",
      cookie: "substack.sid=session-secret; substack.lli=1",
    },
    {
      url: "https://publication.substack.com/api/v1/posts/1",
      cookie: "substack.sid=session-secret; substack.lli=1",
    },
  ]);
});
