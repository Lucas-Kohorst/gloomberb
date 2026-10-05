import { describe, expect, test } from "bun:test";
import { ntiTeamForRateId } from "./nti-teams";

describe("ntiTeamForRateId", () => {
  test("parses team names from NTI rate ids", () => {
    expect(ntiTeamForRateId("nti_ari_win_27")).toBe("Arizona Cardinals");
    expect(ntiTeamForRateId("nti_mv_ari_conf_27")).toBe("Arizona Cardinals");
    expect(ntiTeamForRateId("nti_was_div_26")).toBe("Washington Commanders");
    expect(ntiTeamForRateId("nti_kc_conf_27")).toBe("Kansas City Chiefs");
    expect(ntiTeamForRateId("nti_no_conf_27")).toBe("New Orleans Saints");
    expect(ntiTeamForRateId("nti_ne_conf_27")).toBe("New England Patriots");
    expect(ntiTeamForRateId("  NTI_PIT_WIN_27  ")).toBe("Pittsburgh Steelers");
  });

  test("returns null for unknown codes and non-team ids", () => {
    expect(ntiTeamForRateId("nti_zzz_win_27")).toBeNull();
    expect(ntiTeamForRateId("aapl")).toBeNull();
    expect(ntiTeamForRateId("")).toBeNull();
    expect(ntiTeamForRateId(undefined)).toBeNull();
    expect(ntiTeamForRateId(null)).toBeNull();
  });
});
