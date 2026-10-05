import { expect, test } from "bun:test";
import { supportedLibraryResolution } from "./charting-library-resolution";

test("an unsupported saved intraday interval falls back without changing supported choices", () => {
  expect(supportedLibraryResolution("240", ["D", "W", "M"])).toBe("D");
  expect(supportedLibraryResolution("240", ["1", "60", "240", "D"])).toBe("240");
  expect(supportedLibraryResolution("1D", ["D", "W", "M"])).toBe("1D");
  expect(supportedLibraryResolution("W", ["1D", "1W", "1M"])).toBe("W");
  expect(supportedLibraryResolution("240", ["W", "M"])).toBe("W");
  expect(supportedLibraryResolution("240", undefined)).toBe("240");
});
