export type WebHit = {
  title: string;
  url: string;
  snippet: string;
};

/**
 * Optional evidence context. Failures are swallowed — the crew still runs.
 * Never log the API key.
 */
export async function searchPolicyWeb(query: string): Promise<WebHit[]> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return [];

  try {
    const response = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        limit: 3,
      }),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as {
      data?: Array<{ title?: string; url?: string; description?: string; markdown?: string }>;
    };
    return (data.data ?? [])
      .filter((row) => typeof row.url === "string" && row.url.length > 0)
      .slice(0, 3)
      .map((row) => ({
        title: row.title?.trim() || row.url || "Source",
        url: row.url as string,
        snippet: (row.description || row.markdown || "").slice(0, 400),
      }));
  } catch {
    return [];
  }
}
