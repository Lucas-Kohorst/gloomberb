import { describe, expect, test } from "bun:test";
import {
  getByokKnownService,
  getByokKnownServices,
  registerByokKnownService,
  subscribeByokKnownServices,
} from "./services";

describe("plugin BYOK registration", () => {
  test("discovers a plugin-registered service and withdraws it on dispose", () => {
    const dispose = registerByokKnownService({
      id: "test-plugin-api",
      name: "Test Plugin API",
      description: "Fixture",
      pluginId: "test-plugin",
      authType: "bearer",
    });
    expect(getByokKnownService("test-plugin-api")?.pluginId).toBe("test-plugin");
    expect(getByokKnownServices().some((service) => service.id === "test-plugin-api")).toBe(true);
    dispose();
    expect(getByokKnownService("test-plugin-api")).toBeNull();
  });

  test("notifies subscribers when a plugin registers a keyable service", () => {
    let calls = 0;
    const unsubscribe = subscribeByokKnownServices(() => {
      calls += 1;
    });
    const dispose = registerByokKnownService({
      id: "test-notify-api",
      name: "Notify",
      description: "Fixture",
      authType: "bearer",
    });
    expect(calls).toBe(1);
    dispose();
    expect(calls).toBe(2);
    unsubscribe();
  });
});
