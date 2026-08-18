// Live API verification for the universal series kinds that have public endpoints.
// Run with: bun scripts/verify-live-series.ts

import { getSharedAdjacentClient } from "../src/plugins/builtin/adjacent/client";
import { normalizeAdjacentIndexPrices } from "../src/plugins/builtin/adjacent/normalize";
import { fetchArtificialAnalysisData } from "../src/plugins/builtin/llm-stats/client";
import { fetchVoteHubPolls } from "../src/plugins/builtin/polls/client";
import { computePollTrend, normalizeVoteHubPoll } from "../src/plugins/builtin/polls/normalize";
import {
  loadAdjacentIndexSeries,
  loadBenchmarkSeries,
  loadPollSeries,
} from "../src/time-series/hooks";

console.log("=== Live API Verification ===\n");

// 1. Adjacent indices — public endpoint
console.log("--- Adjacent Indices ---");
try {
  const client = getSharedAdjacentClient();
  const indices = await client.getIndices();
  const indexList = indices.data ?? [];
  console.log(`  Fetched ${indexList.length} indices`);
  if (indexList.length > 0) {
    const first = indexList[0]!;
    console.log(`  First index: ${first.index_id} (${first.name}), latest_price: ${first.latest_price}`);
    const prices = await client.getIndexPrices(first.index_id);
    const pricePoints = normalizeAdjacentIndexPrices(prices.data ?? []);
    console.log(`  Price history: ${pricePoints.length} points`);
    if (pricePoints.length > 0) {
      console.log(`    First: ${pricePoints[0]!.date.toISOString().slice(0,10)} = ${pricePoints[0]!.value}`);
      console.log(`    Last:  ${pricePoints.at(-1)!.date.toISOString().slice(0,10)} = ${pricePoints.at(-1)!.value}`);
    }
    // Test the loader function
    const loaded = await loadAdjacentIndexSeries(first.index_id);
    console.log(`  Loader result: ${loaded.points.length} points, unit="${loaded.unit}"`);
  }
} catch (err) {
  console.log(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
}
console.log();

// 2. AI benchmarks — Artificial Analysis
console.log("--- AI Benchmarks (artificialanalysis.ai) ---");
try {
  const data = await fetchArtificialAnalysisData();
  console.log(`  Fetched ${data.rows.length} model rows`);
  const orgs = [...new Set(data.rows.map((r) => r.creator))].sort();
  console.log(`  Organizations: ${orgs.slice(0, 10).join(", ")}${orgs.length > 10 ? "..." : ""}`);
  const openai = data.rows.filter((r) => r.creator.toLowerCase() === "openai" && r.releaseDate);
  console.log(`  OpenAI models with release dates: ${openai.length}`);
  if (openai.length > 0) {
    console.log(`    Examples: ${openai.slice(0, 3).map((r) => `${r.name} (${r.releaseDate}, intelligence=${r.intelligence})`).join(", ")}`);
  }
  const loaded = await loadBenchmarkSeries("gpt-4o", "intelligence");
  console.log(`  Loader result: ${loaded.points.length} points, unit="${loaded.unit}"`);
  if (loaded.warning) console.log(`  Warning: ${loaded.warning}`);
} catch (err) {
  console.log(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
}
console.log();

// 3. Polls (VoteHub) — public endpoint
console.log("--- Polls (VoteHub) ---");
try {
  const polls = await fetchVoteHubPolls({ subject: "Donald Trump" });
  console.log(`  Fetched ${polls.length} polls for "Donald Trump"`);
  if (polls.length > 0) {
    const rows = polls.map(normalizeVoteHubPoll);
    const trend = computePollTrend(rows, "Donald Trump", "Approve");
    console.log(`  Trend points for "Approve": ${trend.length}`);
    if (trend.length > 0) {
      console.log(`    First: ${trend[0]!.date} = ${trend[0]!.value}%`);
      console.log(`    Last:  ${trend.at(-1)!.date} = ${trend.at(-1)!.value}%`);
    }
    // Test the loader
    const loaded = await loadPollSeries("Donald Trump", "Approve");
    console.log(`  Loader result: ${loaded.points.length} points, unit="${loaded.unit}"`);
  }
} catch (err) {
  console.log(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
}
console.log();

console.log("=== Done ===\n");
