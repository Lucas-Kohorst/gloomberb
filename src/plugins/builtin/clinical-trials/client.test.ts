import { describe, expect, test } from "bun:test";
import {
  buildStudiesUrl,
  parseClinicalTrial,
  parseClinicalTrialsPage,
} from "./client";

function studyFixture(overrides: Record<string, unknown> = {}) {
  return {
    protocolSection: {
      identificationModule: {
        nctId: "NCT05123456",
        briefTitle: "Pembrolizumab in NSCLC",
        officialTitle: "A Phase 3 Study of Pembrolizumab in NSCLC",
      },
      statusModule: {
        overallStatus: "RECRUITING",
        startDateStruct: { date: "2024-01-15", type: "ACTUAL" },
        completionDateStruct: { date: "2026-06-30", type: "ESTIMATED" },
        studyFirstSubmitDate: "2023-10-01",
      },
      sponsorCollaboratorsModule: {
        leadSponsor: { name: "Merck Sharp & Dohme LLC", class: "INDUSTRY" },
      },
      designModule: {
        studyType: "INTERVENTIONAL",
        phases: ["PHASE3"],
        enrollmentInfo: { count: 450, type: "ESTIMATED" },
      },
      conditionsModule: { conditions: ["Non-Small Cell Lung Cancer"] },
      descriptionModule: { briefSummary: "Testing pembrolizumab efficacy." },
      ...overrides,
    },
  };
}

describe("clinical trials parsing", () => {
  test("parses a full v2 study record", () => {
    const trial = parseClinicalTrial(studyFixture());
    expect(trial?.nctId).toBe("NCT05123456");
    expect(trial?.title).toBe("Pembrolizumab in NSCLC");
    expect(trial?.status).toBe("RECRUITING");
    expect(trial?.phases).toEqual(["PHASE3"]);
    expect(trial?.sponsor).toBe("Merck Sharp & Dohme LLC");
    expect(trial?.sponsorClass).toBe("INDUSTRY");
    expect(trial?.conditions).toEqual(["Non-Small Cell Lung Cancer"]);
    expect(trial?.enrollment).toBe(450);
    expect(trial?.startDate?.toISOString().slice(0, 10)).toBe("2024-01-15");
    expect(trial?.completionDate?.toISOString().slice(0, 10)).toBe("2026-06-30");
    expect(trial?.url).toBe("https://clinicaltrials.gov/study/NCT05123456");
  });

  test("tolerates missing modules with safe defaults", () => {
    const trial = parseClinicalTrial({
      protocolSection: { identificationModule: { nctId: "NCT00000001" } },
    });
    expect(trial?.title).toBe("NCT00000001");
    expect(trial?.status).toBe("UNKNOWN");
    expect(trial?.phases).toEqual([]);
    expect(trial?.sponsor).toBe("Unknown sponsor");
    expect(trial?.startDate).toBeNull();
    expect(trial?.completionDate).toBeNull();
    expect(trial?.url).toBe("https://clinicaltrials.gov/study/NCT00000001");
  });

  test("drops studies without an NCT id", () => {
    const page = parseClinicalTrialsPage({
      totalCount: 3,
      studies: [studyFixture(), {}, { protocolSection: { identificationModule: {} } }],
    });
    expect(page.trials).toHaveLength(1);
    expect(page.total).toBe(3);
  });

  test("caps at the display limit", () => {
    const studies = Array.from({ length: 10 }, (_, index) =>
      studyFixture({
        identificationModule: {
          nctId: `NCT1000000${index}`,
          briefTitle: `Study ${index}`,
        },
      }),
    );
    const page = parseClinicalTrialsPage({ totalCount: 10, studies }, 4);
    expect(page.trials).toHaveLength(4);
    expect(page.trials[0]?.nctId).toBe("NCT10000000");
  });

  test("builds sponsor and term queries as format=json", () => {
    const sponsUrl = buildStudiesUrl({ sponsor: "Pfizer" });
    expect(sponsUrl).toContain("format=json");
    expect(sponsUrl).toContain(`query.spons=${encodeURIComponent("Pfizer")}`);

    const termUrl = buildStudiesUrl({ term: "diabetes" });
    expect(termUrl).toContain("format=json");
    expect(termUrl).toContain(`query.term=${encodeURIComponent("diabetes")}`);
  });
});
