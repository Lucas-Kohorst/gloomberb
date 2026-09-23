import { afterEach, describe, expect, test } from "bun:test";
import type { GloomPluginContext } from "../../../types/plugin";
import { getByokKnownServices, registerByokKnownService } from "../byok/services";
import { listConnectionSources } from "../connections/register";
import { opticOddsPlugin } from "./index";

const disposers: Array<() => void> = [];

afterEach(() => {
  opticOddsPlugin.dispose?.();
  for (const dispose of disposers.splice(0)) dispose();
});

describe("OpticOdds registration", () => {
  test("setup registers one BYOK service and one connection", async () => {
    const ctx = {
      pluginId: "opticodds",
      getApiKey: () => undefined,
      registerByokService: (service: { id: string; name: string; description: string; apiUrl?: string; authType?: "header"; authKey?: string; envVar?: string }) => {
        const dispose = registerByokKnownService({
          authType: "header",
          ...service,
          pluginId: "opticodds",
        });
        disposers.push(dispose);
        return dispose;
      },
    } as unknown as GloomPluginContext;

    await opticOddsPlugin.setup?.(ctx);
    await opticOddsPlugin.setup?.(ctx);

    const services = getByokKnownServices().filter((service) => service.name === "OpticOdds");
    const connections = listConnectionSources().filter((source) => source.name === "OpticOdds");
    expect(services.map((service) => service.id)).toEqual(["opticodds"]);
    expect(connections.map((source) => source.id)).toEqual(["opticodds"]);
  });
});
