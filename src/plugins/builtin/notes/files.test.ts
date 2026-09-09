import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import { NotesFiles } from "./files";

test("NotesFiles.delete ignores only missing files", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "gloomberb-notes-"));
  const notes = new NotesFiles(dataDir);
  mkdirSync(join(dataDir, "blocked.md"));

  try {
    await expect(notes.delete("missing")).resolves.toBeUndefined();
    await expect(notes.delete("blocked")).rejects.toBeDefined();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("rejects traversal-bearing note keys before touching the filesystem", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "gloomberb-notes-"));
  const notes = new NotesFiles(dataDir);
  const outsideKey = `../${basename(dataDir)}-outside`;
  const outsidePath = join(dataDir, "..", `${basename(dataDir)}-outside.md`);

  try {
    expect(existsSync(outsidePath)).toBe(false);
    await expect(notes.save(outsideKey, "escaped")).rejects.toThrow("Invalid note key");
    await expect(notes.load("../../etc/passwd")).rejects.toThrow("Invalid note key");
    await expect(notes.delete("/tmp/escaped")).rejects.toThrow("Invalid note key");
    expect(existsSync(outsidePath)).toBe(false);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
