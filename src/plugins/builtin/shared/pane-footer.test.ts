import { describe, expect, test } from "bun:test";
import {
  PANE_FOOTER_ACTION_KEYS,
  paneRefreshHint,
  paneSearchHint,
} from "./pane-footer";

describe("pane footer action keys", () => {
  test("search is / and refresh is r", () => {
    expect(PANE_FOOTER_ACTION_KEYS.search).toBe("/");
    expect(PANE_FOOTER_ACTION_KEYS.refresh).toBe("r");
    expect(PANE_FOOTER_ACTION_KEYS.open).toBe("o");
  });

  test("search and refresh hint builders match the bound keys", () => {
    const search = paneSearchHint(() => {});
    const refresh = paneRefreshHint(() => {});
    expect(search.id).toBe("search");
    expect(search.key).toBe("/");
    expect(refresh.id).toBe("refresh");
    expect(refresh.key).toBe("r");
    expect(search.key).not.toBe("s");
    expect(refresh.key).not.toBe("Shift+R");
  });
});
