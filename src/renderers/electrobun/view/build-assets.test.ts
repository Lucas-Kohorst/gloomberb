import { describe, expect, test } from "bun:test";
import { rewriteChunkEntryImportSource } from "./build-assets";

describe("split chunk entry rewrite", () => {
  test("points hashed web-main imports at the hashed entry file", () => {
    const source = 'import{i,r}from"./web-main.js";export function pane(){}';
    expect(rewriteChunkEntryImportSource(source, "web-main.js", "web-main.abc123.js"))
      .toBe('import{i,r}from"./web-main.abc123.js";export function pane(){}');
  });
});
