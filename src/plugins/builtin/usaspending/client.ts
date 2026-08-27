import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { withConnectionRequest } from "../connections/register";
import {
  USASPENDING_API_BASE_URL,
  USASPENDING_CONNECTION_ID,
  type SpendingAward,
  type SpendingDetail,
  type SpendingPage,
} from "./types";

const apiFetch = createThrottledFetch({
  requestsPerMinute: 30,
  maxRetries: 2,
  timeoutMs: 15_000,
  backoffBaseMs: 500,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "gloomberb-usaspending",
  },
  transport: (url: string, init?: RequestInit) => httpFetch(url, init),
});

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function parseAward(raw: unknown): SpendingAward | null {
  const record = asRecord(raw);
  const recipient = asRecord(record.recipient);
  const agency = asRecord(record.awarding_agency);
  const id = asString(record["Award ID"]) || asString(record.award_id)
    || asString(record.generated_unique_award_id) || asString(record.id);
  if (!id) return null;
  return {
    id,
    recipientName: asString(record["Recipient Name"]) || asString(record.recipient_name)
      || asString(recipient.recipient_name) || asString(recipient.name),
    awardingAgency: asString(record["Awarding Agency"]) || asString(record.awarding_agency)
      || asString(agency.toptier_agency_name) || asString(agency.name),
    awardAmount: asNumber(record["Award Amount"] ?? record.award_amount
      ?? record.total_obligation ?? record.total_obligated_amount),
    startDate: asString(record["Period of Performance Start Date"])
      || asString(record.period_of_performance_start_date),
    endDate: asString(record["Period of Performance End Date"])
      || asString(record.period_of_performance_end_date),
    awardType: asString(record["Award Type"]) || asString(record.award_type)
      || asString(record.award_type_description),
    description: asString(record.Description) || asString(record.description),
  };
}

function stringifyLocation(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const record = asRecord(value);
  return [
    record.address_line_1 ?? record.addressLine1,
    record.address_line_2 ?? record.addressLine2,
    record.city_name ?? record.city,
    record.state_code ?? record.state,
    record.zip ?? record.zipcode,
    record.country_name ?? record.country,
  ].filter((part): part is string | number => typeof part === "string" || typeof part === "number")
    .map(String).map((part) => part.trim()).filter(Boolean).join(", ");
}

export class SpendingClient {
  private async json(url: string, init?: RequestInit): Promise<unknown> {
    const response = await apiFetch.fetch(url, init);
    if (!response.ok) {
      throw new Error(`USAspending request failed: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  async listAwards(query: string, page = 1): Promise<SpendingPage> {
    return withConnectionRequest(USASPENDING_CONNECTION_ID, "fetch", async () => {
      const filters: Record<string, unknown> = {
        award_type_codes: ["A", "B", "C", "D"],
        time_period: [{ start_date: "2024-01-01", end_date: "2025-12-31" }],
      };
      if (query.trim()) filters.recipient_search_text = query.trim();
      const payload = asRecord(await this.json(
        `${USASPENDING_API_BASE_URL}/api/v2/search/spending_by_award/`,
        {
          method: "POST",
          body: JSON.stringify({
            filters,
            fields: [
              "Award ID", "Recipient Name", "Awarding Agency", "Award Amount",
              "Period of Performance Start Date", "Period of Performance End Date",
              "Award Type", "Description", "COVID-19 Obligations",
            ],
            page,
            limit: 50,
            sort: "Award Amount",
            order: "desc",
          }),
        },
      ));
      const results = Array.isArray(payload.results) ? payload.results : [];
      const metadata = asRecord(payload.page_metadata);
      const awards: SpendingAward[] = [];
      for (const raw of results) {
        const award = parseAward(raw);
        if (!award) continue;
        awards.push(award);
        if (awards.length >= 50) break;
      }
      return {
        awards,
        total: asNumber(metadata.count),
        hasNext: metadata.hasNext === true,
      };
    });
  }

  async getAwardDetail(id: string): Promise<SpendingDetail | null> {
    return withConnectionRequest(USASPENDING_CONNECTION_ID, "fetch", async () => {
      const response = await apiFetch.fetch(
        `${USASPENDING_API_BASE_URL}/api/v2/awards/${encodeURIComponent(id)}/`,
      );
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(`USAspending request failed: ${response.status} ${response.statusText}`);
      }
      const payload = asRecord(await response.json());
      const award = parseAward(payload.award ?? payload);
      if (!award) return null;
      const recipient = asRecord(payload.recipient);
      const performance = payload.place_of_performance ?? payload.placeOfPerformance;
      return {
        award,
        recipientAddress: stringifyLocation(payload.recipient_address ?? payload.recipientAddress
          ?? recipient.address ?? recipient.location),
        placeOfPerformance: stringifyLocation(performance),
        sourceUrl: `https://www.usaspending.gov/award/${encodeURIComponent(id)}`,
      };
    });
  }
}
