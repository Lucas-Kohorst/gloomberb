import { apiClient, type CloudEconEventPayload } from "../../../api-client";
import { withConnectionRequest } from "../connections/register";
import type { EconEvent } from "./types";

/** Connections row for Gloom Cloud GET /cloud/econ/calendar. Not a second calendar. */
export const ECON_CALENDAR_CONNECTION_ID = "gloom-cloud-econ-calendar";
export const ECON_CALENDAR_CONNECTION_NAME = "Gloom Cloud Economic Calendar";

function toEconEvent(event: CloudEconEventPayload): EconEvent {
  return {
    ...event,
    date: new Date(event.date),
  };
}

export async function fetchEconCalendar(): Promise<EconEvent[]> {
  return withConnectionRequest(ECON_CALENDAR_CONNECTION_ID, "calendar", async () => {
    const events = await apiClient.getCloudEconomicCalendar();
    return events.map(toEconEvent);
  });
}
