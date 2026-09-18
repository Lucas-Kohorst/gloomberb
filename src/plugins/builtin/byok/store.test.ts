import { describe, expect, test } from "bun:test";
import { createDefaultConfig } from "../../../types/config";
import { readByokKeysFromConfig, selectByokKeys } from "./store";

describe("BYOK key selectors", () => {
  test("empty snapshots reuse one array so useAppSelector cannot loop", () => {
    const config = createDefaultConfig("/tmp/gloom-byok-select");
    const state = { config };
    expect(selectByokKeys(state)).toBe(selectByokKeys(state));
    expect(readByokKeysFromConfig(config)).toBe(readByokKeysFromConfig(config));
  });
});
