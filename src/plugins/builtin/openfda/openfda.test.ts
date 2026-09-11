import { afterEach, describe, expect, test } from "bun:test";
import { setHttpFetchTransport } from "../../../utils/http-transport";
import {
  buildDeviceEventSearch,
  buildDrugEventSearch,
  buildRecallSearch,
  mergeOpenFdaPages,
  OpenFdaClient,
  parseDeviceEvent,
  parseDeviceEventPage,
  parseDrugEvent,
  parseDrugEventPage,
  parseOpenFdaDate,
  parseRecall,
  parseRecallPage,
} from "./client";
import type { OpenFdaPage } from "./types";

afterEach(() => {
  setHttpFetchTransport(null);
});

const DRUG_FIXTURE = {
  safetyreportid: "10003304-1",
  serious: "1",
  receivedate: "20240115",
  patient: {
    reaction: [
      { reactionmeddrapt: "Nausea" },
      { reactionmeddrapt: "Headache" },
    ],
    drug: [
      {
        medicinalproduct: "IBUPROFEN",
        openfda: {
          brand_name: ["Advil"],
          manufacturer_name: ["Pfizer Inc"],
        },
      },
    ],
  },
};

const DEVICE_FIXTURE = {
  mdr_report_key: "98765",
  event_type: "Malfunction",
  date_received: "20240220",
  device: [
    {
      brand_name: "HeartPump X",
      generic_name: "Ventricular pump",
      manufacturer_d_name: "Acme Medical",
      device_report_product_code: "XYZ",
      model_number: "HP-1",
    },
  ],
};

const RECALL_FIXTURE = {
  recall_number: "D-001-2024",
  recalling_firm: "Acme Pharma",
  product_description: "Ibuprofen 200mg tablets, 100 count",
  reason_for_recall: "Failed dissolution specifications",
  classification: "Class II",
  status: "Ongoing",
  recall_initiation_date: "20240301",
};

describe("openfda search builders", () => {
  test("drug search spans product, brand, generic, and manufacturer", () => {
    const search = buildDrugEventSearch("ibuprofen");
    expect(search).toContain('patient.drug.medicinalproduct:"ibuprofen"');
    expect(search).toContain('patient.drug.openfda.brand_name:"ibuprofen"');
    expect(search).toContain('patient.drug.openfda.generic_name:"ibuprofen"');
    expect(search).toContain('patient.drug.openfda.manufacturer_name:"ibuprofen"');
  });

  test("device search spans brand, generic, and manufacturer", () => {
    const search = buildDeviceEventSearch("Acme");
    expect(search).toContain('device.brand_name:"Acme"');
    expect(search).toContain('device.generic_name:"Acme"');
    expect(search).toContain('device.manufacturer_d_name:"Acme"');
  });

  test("recall search spans firm, product, and reason", () => {
    const search = buildRecallSearch("Acme");
    expect(search).toContain('recalling_firm:"Acme"');
    expect(search).toContain('product_description:"Acme"');
    expect(search).toContain('reason_for_recall:"Acme"');
  });

  test("blank queries build no search param", () => {
    expect(buildDrugEventSearch("   ")).toBeUndefined();
    expect(buildDeviceEventSearch("")).toBeUndefined();
    expect(buildRecallSearch("  ")).toBeUndefined();
  });

  test("embedded quotes are stripped so the search stays valid", () => {
    expect(buildDrugEventSearch('a"b')).toContain('"ab"');
  });
});

describe("openfda date parsing", () => {
  test("parses YYYYMMDD as UTC", () => {
    expect(parseOpenFdaDate("20240115").toISOString()).toBe("2024-01-15T00:00:00.000Z");
  });

  test("parses dashed dates too", () => {
    expect(parseOpenFdaDate("2024-02-20").toISOString()).toBe("2024-02-20T00:00:00.000Z");
  });

  test("falls back to epoch for garbage", () => {
    expect(parseOpenFdaDate("not-a-date").getTime()).toBe(0);
    expect(parseOpenFdaDate(undefined).getTime()).toBe(0);
  });
});

describe("openfda record parsing", () => {
  test("drug event picks product, company, reactions, and seriousness", () => {
    const record = parseDrugEvent(DRUG_FIXTURE, 0);
    expect(record?.id).toBe("drug:10003304-1");
    expect(record?.dataset).toBe("drug");
    expect(record?.product).toBe("IBUPROFEN");
    expect(record?.company).toBe("Pfizer Inc");
    expect(record?.title).toContain("IBUPROFEN");
    expect(record?.title).toContain("Nausea");
    expect(record?.flag).toBe("Serious");
    expect(record?.date.toISOString()).toBe("2024-01-15T00:00:00.000Z");
    expect(record?.url).toContain("drug/event.json");
    expect(record?.url).toContain("10003304-1");
  });

  test("drug event flags death over serious", () => {
    const record = parseDrugEvent({ ...DRUG_FIXTURE, seriousnessdeath: "1" }, 0);
    expect(record?.flag).toBe("Death");
  });

  test("drug event survives missing openfda block", () => {
    const record = parseDrugEvent({
      safetyreportid: "9",
      receivedate: "20240101",
      patient: { drug: [{ medicinalproduct: "ASPIRIN" }] },
    }, 0);
    expect(record?.product).toBe("ASPIRIN");
    expect(record?.company).toBe("");
    expect(record?.detail).toEqual([]);
  });

  test("drug event page reads the total from meta", () => {
    const page = parseDrugEventPage({
      meta: { results: { total: 617933 } },
      results: [DRUG_FIXTURE],
    });
    expect(page.total).toBe(617933);
    expect(page.records).toHaveLength(1);
  });

  test("device event picks brand, manufacturer, and event type", () => {
    const record = parseDeviceEvent(DEVICE_FIXTURE, 0);
    expect(record?.id).toBe("device:98765");
    expect(record?.product).toBe("HeartPump X");
    expect(record?.company).toBe("Acme Medical");
    expect(record?.flag).toBe("Malfunction");
    expect(record?.detail.join(" ")).toContain("XYZ");
    expect(record?.url).toContain("device/event.json");
  });

  test("device event falls back to generic name for N/A brands", () => {
    const record = parseDeviceEvent({
      mdr_report_key: "1",
      date_received: "20240101",
      device: [{ brand_name: "N/A", generic_name: "Manual bed" }],
    }, 0);
    expect(record?.product).toBe("Manual bed");
  });

  test("recall picks firm, classification, status, and reason", () => {
    const record = parseRecall(RECALL_FIXTURE, 0);
    expect(record?.id).toBe("recall:D-001-2024");
    expect(record?.dataset).toBe("recall");
    expect(record?.company).toBe("Acme Pharma");
    expect(record?.flag).toBe("Class II — Ongoing");
    expect(record?.detail[0]).toContain("dissolution");
    expect(record?.url).toContain("drug/enforcement.json");
  });

  test("empty payloads parse to empty pages", () => {
    expect(parseDrugEventPage({})).toEqual({ records: [], total: 0 });
    expect(parseDeviceEventPage(null)).toEqual({ records: [], total: 0 });
    expect(parseRecallPage({ results: "nope" })).toEqual({ records: [], total: 0 });
    expect(parseDrugEvent(null)).toBeNull();
  });
});

describe("openfda page merging", () => {
  test("merges newest-first, sums totals, and caps", () => {
    const page: OpenFdaPage = mergeOpenFdaPages([
      { records: [parseDrugEvent(DRUG_FIXTURE, 0)!], total: 10 },
      { records: [parseDeviceEvent(DEVICE_FIXTURE, 0)!], total: 20 },
      { records: [parseRecall(RECALL_FIXTURE, 0)!], total: 30 },
    ]);
    expect(page.total).toBe(60);
    expect(page.records.map((record) => record.id)).toEqual([
      "recall:D-001-2024",
      "device:98765",
      "drug:10003304-1",
    ]);
    const capped = mergeOpenFdaPages(
      [{ records: [parseDrugEvent(DRUG_FIXTURE, 0)!], total: 1 }],
      0,
    );
    expect(capped.records).toHaveLength(0);
  });
});

describe("openfda client", () => {
  test("openFDA 404 (no matches) becomes an empty page, not an error", async () => {
    const requested: string[] = [];
    setHttpFetchTransport(async (url: string) => {
      requested.push(url);
      return new Response(JSON.stringify({ error: { code: "NOT_FOUND" } }), { status: 404 });
    });
    const page = await new OpenFdaClient().listRecords({ searchQuery: "zzz-no-such-drug" });
    expect(page).toEqual({ records: [], total: 0 });
    expect(requested).toHaveLength(3);
    expect(requested.some((url) => url.includes("/drug/event.json"))).toBe(true);
    expect(requested.some((url) => url.includes("/device/event.json"))).toBe(true);
    expect(requested.some((url) => url.includes("/drug/enforcement.json"))).toBe(true);
    expect(requested.every((url) => url.includes("search="))).toBe(true);
  });

  test("failed endpoints still throw", async () => {
    setHttpFetchTransport(async () => new Response("oops", { status: 500, statusText: "Bad" }));
    await expect(new OpenFdaClient().listRecords({})).rejects.toThrow();
  });
});
