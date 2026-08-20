/**
 * Display labels for the capability that produced an article. The publisher
 * name alone does not say whether a headline arrived over RSS, an
 * authenticated Substack session, or the cloud wire.
 */
const ORIGIN_LABELS: Record<string, string> = {
  rss: "RSS",
  "substack-news": "Substack",
  substack: "Substack",
  adjacent: "Adjacent",
  yahoo: "Yahoo",
  "gloomberb-cloud": "Wire",
  "x-feed": "X",
};

export function newsOriginLabel(origin: string | undefined): string {
  if (!origin) return "—";
  return ORIGIN_LABELS[origin] ?? origin;
}
