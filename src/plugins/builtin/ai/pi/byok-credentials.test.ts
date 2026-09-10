import { describe, expect, test } from "bun:test";
import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import {
  ByokOverlayCredentialStore,
  setByokApiKeyReader,
} from "./byok-credentials";

function memoryStore(initial: Record<string, Credential> = {}): CredentialStore & { data: Map<string, Credential> } {
  const data = new Map<string, Credential>(Object.entries(initial));
  return {
    data,
    async read(providerId: string) {
      const found = data.get(providerId);
      return found ? structuredClone(found) : undefined;
    },
    async list(): Promise<readonly CredentialInfo[]> {
      return [...data.entries()].map(([providerId, credential]) => ({ providerId, type: credential.type }));
    },
    async modify(providerId: string, update: (current: Credential | undefined) => Promise<Credential | undefined>) {
      const next = await update(data.get(providerId));
      if (next !== undefined) data.set(providerId, structuredClone(next));
      return data.get(providerId);
    },
    async delete(providerId: string) {
      data.delete(providerId);
    },
  };
}

describe("ByokOverlayCredentialStore", () => {
  test("delegates purely when no reader is registered", async () => {
    setByokApiKeyReader(null);
    const inner = memoryStore();
    const overlay = new ByokOverlayCredentialStore(inner);
    expect(await overlay.read("spore")).toBeUndefined();
    await overlay.modify("spore", async () => ({ type: "api_key", key: "k" }));
    expect((await overlay.read("spore"))?.type).toBe("api_key");
  });

  test("stored credentials always win over BYOK keys", async () => {
    setByokApiKeyReader(() => "byok-key");
    const inner = memoryStore({
      anthropic: { type: "oauth", access: "a", refresh: "r", expires: Date.now() + 60_000 },
    });
    const overlay = new ByokOverlayCredentialStore(inner);
    const resolved = await overlay.read("anthropic");
    expect(resolved?.type).toBe("oauth");
    setByokApiKeyReader(null);
  });

  test("BYOK key authenticates a provider with nothing stored", async () => {
    setByokApiKeyReader((providerId) => (providerId === "spore" ? "  sk-spore  " : undefined));
    const overlay = new ByokOverlayCredentialStore(memoryStore());
    try {
      expect(await overlay.read("spore")).toEqual({ type: "api_key", key: "sk-spore" });
      expect(await overlay.read("openai")).toBeUndefined();
    } finally {
      setByokApiKeyReader(null);
    }
  });

  test("blank BYOK keys are ignored", async () => {
    setByokApiKeyReader(() => "   ");
    const overlay = new ByokOverlayCredentialStore(memoryStore());
    try {
      expect(await overlay.read("spore")).toBeUndefined();
    } finally {
      setByokApiKeyReader(null);
    }
  });

  test("writes go to the inner store only", async () => {
    setByokApiKeyReader(() => "byok-key");
    const inner = memoryStore();
    const overlay = new ByokOverlayCredentialStore(inner);
    try {
      await overlay.modify("spore", async () => ({ type: "api_key", key: "manual" }));
      expect(inner.data.get("spore")).toEqual({ type: "api_key", key: "manual" });
      await overlay.delete("spore");
      expect(inner.data.has("spore")).toBe(false);
      // The BYOK key still applies on read (deleted through BYOK settings, not here).
      expect(await overlay.read("spore")).toEqual({ type: "api_key", key: "byok-key" });
    } finally {
      setByokApiKeyReader(null);
    }
  });
});
