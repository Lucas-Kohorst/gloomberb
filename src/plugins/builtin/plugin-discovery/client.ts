import { httpFetch } from "../../../utils/http-transport";
import type { GitHubRepo, PluginSearchResult } from "./types";

const GITHUB_API = "https://api.github.com/search/repositories";

function toSearchResult(repo: GitHubRepo): PluginSearchResult {
  return {
    id: repo.id,
    fullName: repo.full_name,
    description: repo.description ?? "—",
    stars: repo.stargazers_count,
    url: repo.html_url,
    owner: repo.owner.login,
    updatedAt: repo.updated_at,
  };
}

async function fetchRepos(query: string, qualifier: string): Promise<PluginSearchResult[]> {
  const url = new URL(GITHUB_API);
  url.searchParams.set("q", `${query} ${qualifier}`);
  url.searchParams.set("sort", "stars");
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", "30");

  const res = await httpFetch(url.toString(), {
    headers: {
      "Accept": "application/vnd.github+json",
      "User-Agent": "gloomberb",
    },
  });

  if (!res.ok) {
    throw new Error(`GitHub search failed (${res.status})`);
  }

  const data = await res.json() as { items: GitHubRepo[] };
  return data.items.map(toSearchResult);
}

export async function searchPlugins(query: string): Promise<PluginSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  let results = await fetchRepos(trimmed, "topic:gloomberb-plugin");
  if (results.length === 0) {
    results = await fetchRepos(trimmed, "gloomberb in:name,description");
  }
  return results;
}
