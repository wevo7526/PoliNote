import {
  filterReputableHits,
  LITERATURE_QUERY_HINT,
} from "@/lib/sources/reputable";

export type WebHit = {
  title: string;
  url: string;
  snippet: string;
};

const SEARCH_TIMEOUT_MS = 6000;

/**
 * Optional evidence context. Failures are swallowed — the crew still runs.
 * Social and user-generated hosts are dropped. Never log the API key.
 */
export async function searchPolicyWeb(query: string): Promise<WebHit[]> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `${query} ${LITERATURE_QUERY_HINT}`,
        limit: 8,
      }),
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const data = (await response.json()) as {
      data?: Array<{
        title?: string;
        url?: string;
        description?: string;
        markdown?: string;
      }>;
    };
    const hits = (data.data ?? [])
      .filter((row) => typeof row.url === "string" && row.url.length > 0)
      .map((row) => ({
        title: row.title?.trim() || row.url || "Source",
        url: row.url as string,
        snippet: (row.description || row.markdown || "").slice(0, 400),
      }));
    return filterReputableHits(hits).slice(0, 5);
  } catch (error) {
    console.error(
      "[polinote/firecrawl]",
      error instanceof Error ? error.message : "search failed",
    );
    return [];
  } finally {
    clearTimeout(timer);
  }
}
