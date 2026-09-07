import { isStoredShareId } from "./routes";

export function paneShareIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get("share")?.trim() ?? "";
  return isStoredShareId(id) ? id : null;
}

export function isPaneShareHandoff(): boolean {
  const location = (globalThis as { window?: { location?: { search?: unknown } } }).window?.location;
  return typeof location?.search === "string" && paneShareIdFromSearch(location.search) !== null;
}
