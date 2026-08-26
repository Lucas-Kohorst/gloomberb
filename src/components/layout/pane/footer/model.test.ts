import { describe, expect, test } from "bun:test";
import {
  combinePaneFooterRegistrations,
  isPaneFooterLeftSegment,
  type PaneFooterRegistration,
  type PaneFooterSegment,
} from "./model";

function segment(id: string, text: string): PaneFooterSegment {
  return { id, parts: [{ text }] };
}

describe("pane footer left chrome", () => {
  test("keeps source and updated, drops live/streaming/trial", () => {
    expect(isPaneFooterLeftSegment(segment("source", "source ECB"))).toBe(true);
    expect(isPaneFooterLeftSegment(segment("external-link", "source European Central Bank"))).toBe(true);
    expect(isPaneFooterLeftSegment(segment("updated", "updated ~0m"))).toBe(true);
    expect(isPaneFooterLeftSegment(segment("error", "failed"))).toBe(true);
    expect(isPaneFooterLeftSegment(segment("live", "live"))).toBe(false);
    expect(isPaneFooterLeftSegment(segment("running", "Streaming reply"))).toBe(false);
    expect(isPaneFooterLeftSegment(segment("cloud-access", "Pro trial · 6d left"))).toBe(false);
  });

  test("combined left info only includes source and updated", () => {
    const registrations = new Map<string, PaneFooterRegistration>([
      ["feed", {
        info: [
          segment("live", "live"),
          segment("updated", "updated ~0m"),
        ],
      }],
      ["link", {
        info: [segment("external-link", "source European Central Bank")],
        hints: [{ id: "open", key: "o", label: "pen" }],
      }],
      ["agent", {
        info: [segment("running", "Streaming reply")],
      }],
    ]);
    const footer = combinePaneFooterRegistrations(registrations);
    expect(footer.info.map((entry) => entry.id)).toEqual(["updated", "external-link"]);
    expect(footer.hints).toHaveLength(1);
  });
});
