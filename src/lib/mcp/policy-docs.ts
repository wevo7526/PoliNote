import { getJson } from "@/lib/mcp/http";
import { resultHash, spanId } from "@/lib/mcp/hash";
import { searchPolicyWeb } from "@/lib/tools/firecrawl";
import type { EvidenceSpan } from "@/schemas/span";
import type { ToolResult } from "@/tools/registry";

type CongressBill = {
  number?: string;
  title?: string;
  updateDate?: string;
  url?: string;
};

export async function searchPolicy(
  args: Record<string, unknown>,
): Promise<
  ToolResult<{
    docs: Array<{ title: string; url?: string; note?: string }>;
    span: EvidenceSpan;
  }>
> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) return { ok: false, error: "query required" };

  const congressKey = process.env.CONGRESS_API_KEY?.trim();
  if (congressKey) {
    try {
      const url = new URL("https://api.congress.gov/v3/bill");
      url.searchParams.set("limit", "20");
      url.searchParams.set("format", "json");
      url.searchParams.set("api_key", congressKey);
      const data = await getJson<{ bills?: CongressBill[] }>(url.toString());
      const tokens = query
        .toLowerCase()
        .split(/\s+/)
        .filter((token) => token.length > 3);
      const docs = (data.bills ?? [])
        .filter((bill) => {
          const title = (bill.title ?? "").toLowerCase();
          return tokens.length === 0 || tokens.some((token) => title.includes(token));
        })
        .slice(0, 5)
        .map((bill) => ({
          title: bill.title?.trim() || `Bill ${bill.number ?? ""}`.trim(),
          url:
            bill.url ||
            (bill.number
              ? `https://www.congress.gov/search?q=${encodeURIComponent(bill.title || query)}`
              : undefined),
          note: bill.updateDate,
        }));
      if (docs.length > 0) {
        const hash = resultHash(docs.map((doc) => doc.title));
        const span: EvidenceSpan = {
          id: spanId("policy-docs", "search", hash),
          server: "policy-docs",
          tool: "policy.search",
          citation: `Congress.gov: ${docs[0].title}`,
          url: docs[0].url ?? "https://www.congress.gov/",
          resultHash: hash,
        };
        return { ok: true, data: { docs, span }, spanId: span.id };
      }
    } catch {
      // Fall through to official-site search.
    }
  }

  const hits = await searchPolicyWeb(
    `${query} site:congress.gov OR site:cbo.gov OR site:govinfo.gov OR site:virginia.gov`,
  );
  const docs = hits.map((hit) => ({
    title: hit.title,
    url: hit.url,
    note: hit.snippet,
  }));
  const hash = resultHash(docs.map((doc) => doc.url ?? doc.title));
  const span: EvidenceSpan = {
    id: spanId("policy-docs", "search", hash),
    server: "policy-docs",
    tool: "policy.search",
    citation: docs[0]
      ? `Policy doc: ${docs[0].title}`
      : `No official policy document found for “${query}”`,
    url: docs[0]?.url,
    resultHash: hash,
  };
  return { ok: true, data: { docs, span }, spanId: span.id };
}
