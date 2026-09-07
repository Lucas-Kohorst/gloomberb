import type { TimeSeriesPoint } from "../../../time-series/types";
import type { UniversalSeriesLoadResult } from "../../../time-series/resolve";
import { fetchVoteHubPolls } from "./client";
import { computePollTrend, normalizeVoteHubPoll } from "./normalize";
import { chartSeriesProvider } from "../../../capabilities";
import { colors } from "../../../theme/colors";

export async function loadPollSeries(
  subject: string,
  choice: string,
  loadPolls: typeof fetchVoteHubPolls = fetchVoteHubPolls,
): Promise<UniversalSeriesLoadResult> {
  const polls = await loadPolls({ subject });
  const rows = polls.map(normalizeVoteHubPoll);
  const trend = computePollTrend(rows, subject, choice);
  const points: TimeSeriesPoint[] = trend.map((point) => {
    const date = new Date(`${point.date}T00:00:00Z`);
    return {
      date: Number.isFinite(date.getTime()) ? date : new Date(point.date),
      observedAt: Number.isFinite(date.getTime()) ? date : new Date(point.date),
      value: point.value,
      provenance: { providerId: "votehub", quality: "reported" },
    };
  });
  return {
    points,
    unit: "%",
    unitGroup: "percent",
    label: `${subject} ${choice}`,
  };
}

export const POLL_CHART_CAPABILITY_ID = "poll-trends";

export function createPollChartSeriesCapability(loadPolls: typeof fetchVoteHubPolls = fetchVoteHubPolls) {
  return chartSeriesProvider({
    id: POLL_CHART_CAPABILITY_ID,
    name: "Poll trends",
    provider: {
      async resolve({ seriesId }) {
        const parts = seriesId.split("/");
        if (parts.length !== 2) throw new Error("Poll series require a subject and choice.");
        const [subject, choice] = parts.map(decodeURIComponent);
        if (!subject?.trim() || !choice?.trim()) throw new Error("Poll series require a subject and choice.");
        const data = await loadPollSeries(subject, choice, loadPolls);
        return {
          id: `poll:${seriesId}`,
          label: `${subject} ${choice}`,
          color: colors.textBright,
          unit: "%",
          unitGroup: "percent",
          nativeFrequency: "daily",
          dataShape: "scalar",
          style: "line",
          transform: "raw",
          axis: "left",
          panelId: "main",
          interpolation: "none",
          valueRange: { min: 0, max: 100 },
          points: data.points,
        };
      },
    },
  });
}
