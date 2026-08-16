import { describe, expect, test } from "bun:test";
import { ByokOpenApiError, parseByokOpenApi } from "./openapi";

describe("BYOK OpenAPI ingestion", () => {
  test("derives OpenAPI 3 server, bearer auth, and prefers health", () => {
    const result = parseByokOpenApi(JSON.stringify({
      openapi: "3.0.0",
      servers: [{ url: "/v1" }],
      components: { securitySchemes: { auth: { type: "http", scheme: "bearer" } } },
      paths: {
        "/users": { get: { summary: "Users" } },
        "/health": { get: { tags: ["ops"] } },
      },
    }), "https://example.test/docs/openapi.json");
    expect(result.baseUrl).toBe("https://example.test/v1");
    expect(result.authType).toBe("bearer");
    expect(result.probe.path).toBe("/health");
    expect(result.operations).toHaveLength(2);
  });

  test("derives Swagger 2 host, base path, query auth, and fills examples", () => {
    const result = parseByokOpenApi(JSON.stringify({
      swagger: "2.0",
      host: "api.example.test",
      basePath: "/v2",
      schemes: ["https"],
      securityDefinitions: { key: { type: "apiKey", name: "token", in: "query" } },
      paths: { "/items": { get: { parameters: [{ name: "limit", in: "query", required: true, default: 1 }] } } },
    }));
    expect(result.baseUrl).toBe("https://api.example.test/v2");
    expect(result.authType).toBe("query");
    expect(result.authKey).toBe("token");
    expect(result.probe.probeUrl).toBe("https://api.example.test/v2/items?limit=1");
  });

  test("prefers shorter callable GET when health is unavailable", () => {
    const result = parseByokOpenApi(JSON.stringify({
      openapi: "3.0.0",
      servers: [{ url: "https://example.test" }],
      paths: {
        "/longer": { get: { parameters: [{ name: "x", in: "query", required: true, example: "ok" }] } },
        "/me": { get: {} },
      },
    }));
    expect(result.probe.path).toBe("/me");
  });

  test("reports YAML and specs without safe GET operations", () => {
    expect(() => parseByokOpenApi("openapi: 3.0.0")).toThrow("Only JSON");
    expect(() => parseByokOpenApi(JSON.stringify({
      openapi: "3.0.0",
      servers: [{ url: "https://example.test" }],
      paths: { "/items/{id}": { get: { parameters: [{ name: "id", in: "path", required: true }] } } },
    }))).toThrow(ByokOpenApiError);
  });
});
