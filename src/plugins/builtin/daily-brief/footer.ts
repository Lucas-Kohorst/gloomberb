const NEW_YORK = "America/New_York";

export function briefFooterInfo(input: {
  loading?: boolean;
  error?: string | null;
  stale?: boolean;
  asOf?: string | null;
}): string {
  if (input.loading) return "Loading";
  const error = input.error?.trim();
  if (error) return error;
  if (input.stale) return "Delayed";
  if (input.asOf) {
    const date = new Date(input.asOf);
    if (!Number.isNaN(date.getTime())) {
      const time = date.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZone: NEW_YORK,
      });
      return `as of ${time}`;
    }
  }
  return "Live";
}
