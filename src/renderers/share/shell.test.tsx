/** @jsxImportSource react */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ShareShell } from "./shell";

test("unauthenticated share chrome offers sign up and log in instead of back", () => {
  const html = renderToStaticMarkup(
    <ShareShell title="Story">body</ShareShell>,
  );
  expect(html).toContain("Sign up");
  expect(html).toContain("Log in");
  expect(html).toContain("/?auth=signup");
  expect(html).toContain("/?auth=login");
  expect(html).not.toContain("« Back");
});

test("a signed-in session swaps the header to back into the terminal", async () => {
  const testWindow = new Window({ url: "https://terminal.kohor.st/article/story--AbCd1234" });
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  Object.assign(globalThis, { window: testWindow, document: testWindow.document, IS_REACT_ACT_ENVIRONMENT: true });
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.includes("/api/auth/session")) {
      return Response.json({ user: { id: "u1" }, degraded: false });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  const container = testWindow.document.createElement("div");
  const root = createRoot(container as unknown as HTMLElement);
  try {
    await act(async () => root.render(<ShareShell title="Story">body</ShareShell>));
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain("« Back");
    expect(container.textContent).not.toContain("Sign up");
  } finally {
    await act(async () => root.unmount());
    Object.assign(globalThis, previous);
    testWindow.close();
  }
});
