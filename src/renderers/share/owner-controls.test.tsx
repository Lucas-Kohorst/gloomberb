/** @jsxImportSource react */
import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SocialShareApp } from "./app";

test("content owners can retry a failed deletion, with pending state and revocation feedback", async () => {
  const testWindow = new Window({ url: "https://terminal.kohor.st" });
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  Object.assign(globalThis, { window: testWindow, document: testWindow.document, IS_REACT_ACT_ENVIRONMENT: true });
  let finishDelete: (response: Response) => void = () => {};
  let deletes = 0;
  globalThis.fetch = (async (_input, init) => {
    if (init?.method === "DELETE") {
      deletes++;
      return new Promise<Response>((resolve) => { finishDelete = resolve; });
    }
    return Response.json({ kind: "article", data: { title: "Owner article", text: "Body" }, createdAt: "2026-09-01T00:00:00Z", expiresAt: "2026-10-01T00:00:00Z", ownedByViewer: true });
  }) as typeof fetch;
  const container = testWindow.document.createElement("div");
  const root = createRoot(container as unknown as HTMLElement);
  try {
    await act(async () => root.render(<SocialShareApp location={new URL("https://terminal.kohor.st/s/0123456789abcdef0123456789abcdef")} />));
    const button = container.querySelector(".owner-actions button")!;
    expect(button).not.toBeNull();
    await act(async () => (button as unknown as HTMLElement).click());
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(deletes).toBe(1);
    await act(async () => finishDelete(new Response(null, { status: 503 })));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not delete share");
    expect(button.hasAttribute("disabled")).toBe(false);
    await act(async () => (button as unknown as HTMLElement).click());
    await act(async () => finishDelete(new Response(null, { status: 204 })));
    expect(container.textContent).toContain("Share deleted");
    expect(container.textContent).not.toContain("Owner article");
  } finally {
    await act(async () => root.unmount());
    Object.assign(globalThis, previous);
    testWindow.close();
  }
});
