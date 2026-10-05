import { afterEach, describe, expect, test } from "bun:test";
import type { GloomPluginContext } from "../../../types/plugin";
import { listConnectionSources } from "../connections/register";
import { opticOddsPlugin } from "./index";

afterEach(() => {
  opticOddsPlugin.dispose?.();
});

describe("OpticOdds registration", () => {
  test("setup registers one connection", async () => {
    const ctx = {
      pluginId: "opticodds",
      getApiKey: () => undefined,
      registerByokService: () => () => {},
    } as unknown as GloomPluginContext;

    await opticOddsPlugin.setup?.(ctx);
    await opticOddsPlugin.setup?.(ctx);

    const connections = listConnectionSources().filter((source) => source.name === "OpticOdds");
    expect(connections.map((source) => source.id)).toEqual(["opticodds"]);
  });
});
