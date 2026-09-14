import type { Quote } from "../../../types/financials";
import type { NewsArticle } from "../../../news/types";
import type { AlertRule } from "./types";

export function evaluatePctDayAlert(alert: AlertRule, changePercent: number | undefined): boolean {
  return alert.status === "active"
    && alert.condition === "pct_day"
    && Number.isFinite(changePercent)
    && Math.abs(changePercent!) >= alert.targetPrice;
}

export function evaluateVolumeSpikeAlert(
  alert: AlertRule,
  volume: number | undefined,
  averageVolume: number | undefined,
): boolean {
  return alert.status === "active"
    && alert.condition === "volume_spike"
    && Number.isFinite(volume)
    && Number.isFinite(averageVolume)
    && averageVolume! > 0
    && volume! >= alert.targetPrice * averageVolume!;
}

export function evaluateQuoteCondition(alert: AlertRule, quote: Quote): boolean {
  if (alert.condition === "pct_day") return evaluatePctDayAlert(alert, quote.changePercent);
  if (alert.condition === "volume_spike") {
    return evaluateVolumeSpikeAlert(alert, quote.volume, quote.averageVolume);
  }
  return false;
}

export interface NewsMentionEvaluation {
  triggered: boolean;
  lastSeenArticleId?: string;
  lastSeenArticlePublishedAt?: number;
}

function articleRank(article: NewsArticle): [number, string] {
  const publishedAt = article.publishedAt.getTime();
  return [Number.isFinite(publishedAt) ? publishedAt : 0, article.id];
}

function isNewerThan(
  article: NewsArticle,
  seenAt: number,
  seenId: string,
): boolean {
  const [publishedAt, id] = articleRank(article);
  return publishedAt > seenAt || (publishedAt === seenAt && id > seenId);
}

/** Baselines on the first poll and subsequently considers only articles newer than the stored watermark. */
export function evaluateNewsMentionAlert(
  alert: AlertRule,
  articles: readonly NewsArticle[],
): NewsMentionEvaluation {
  if (alert.status !== "active" || alert.condition !== "news_mention") return { triggered: false };
  const latest = articles.reduce<NewsArticle | null>((current, article) => (
    !current || isNewerThan(article, ...articleRank(current)) ? article : current
  ), null);
  if (!latest) return { triggered: false };

  const seenAt = alert.lastSeenArticlePublishedAt;
  const seenId = alert.lastSeenArticleId ?? "";
  const hasWatermark = seenAt != null && Number.isFinite(seenAt);
  const keyword = alert.targetText?.trim().toLocaleLowerCase();
  const triggered = !!keyword
    && hasWatermark
    && articles.some((article) => (
      isNewerThan(article, seenAt!, seenId)
      && `${article.title}\n${article.summary ?? ""}`.toLocaleLowerCase().includes(keyword)
    ));
  const [lastSeenArticlePublishedAt, lastSeenArticleId] = articleRank(latest);
  return { triggered, lastSeenArticleId, lastSeenArticlePublishedAt };
}
