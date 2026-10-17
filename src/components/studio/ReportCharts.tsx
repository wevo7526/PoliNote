"use client";

import { LANE_LABEL, SPINE_LANES, nodeLane, type PolicyLane } from "@/lib/ai/layout";
import { shortNodeKey } from "@/lib/ui/prose";
import type { NodeAnalysis } from "@/schemas/analysis";
import type { DigressionNode, ProvenanceChip } from "@/schemas/digression";

export type ExtractedSeries = {
  key: string;
  seriesId: string;
  title: string;
  units: string;
  url?: string;
  spanId?: string;
  nodeTitle: string;
  points: Array<{ date: string; value: number }>;
};

export function extractFredSeries(nodes: DigressionNode[]): ExtractedSeries[] {
  const seen = new Set<string>();
  const out: ExtractedSeries[] = [];
  for (const node of nodes) {
    for (const chip of node.provenance) {
      if (!chip.seriesPoints || chip.seriesPoints.length < 2) continue;
      const id = chip.seriesId || chip.spanId || chip.label;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        key: id,
        seriesId: chip.seriesId ?? "FRED",
        title: chip.seriesTitle || chip.label,
        units: chip.units ?? "",
        url: chip.url,
        spanId: chip.spanId,
        nodeTitle: node.title,
        points: chip.seriesPoints,
      });
    }
  }
  return out;
}

export function FredSeriesChartCard({ series }: { series: ExtractedSeries }) {
  const pts = series.points;
  if (pts.length < 2) return null;
  const values = pts.map((p) => p.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const delta = last.value - first.value;
  const pct =
    first.value !== 0 ? ((delta / Math.abs(first.value)) * 100).toFixed(1) : "0.0";

  const w = 520;
  const h = 136;
  const padL = 12;
  const padR = 12;
  const padT = 16;
  const padB = 22;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const coords = pts.map((pt, idx) => {
    const x = padL + (idx / Math.max(1, pts.length - 1)) * plotW;
    const y = padT + plotH - ((pt.value - minV) / range) * plotH;
    return { x, y, date: pt.date, value: pt.value };
  });

  const linePath = coords
    .map((c, idx) => `${idx === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L ${coords[coords.length - 1]!.x.toFixed(1)} ${(padT + plotH).toFixed(1)} L ${coords[0]!.x.toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;

  return (
    <article className="report-chart-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
            FRED Series · {series.seriesId}
          </p>
          <h3 className="mt-0.5 font-[family-name:var(--font-display)] text-base leading-snug text-[var(--ink)]">
            {series.title}
          </h3>
          {series.units ? (
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">{series.units}</p>
          ) : null}
        </div>
        <div className="text-right">
          <p className="font-mono text-lg font-semibold text-[#8fbf9a]">
            {last.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
          <p className="font-mono text-[10px] text-[var(--muted)]">
            {delta >= 0 ? `+${pct}%` : `${pct}%`} ({first.date} → {last.date})
          </p>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="mt-3 h-32 w-full"
        role="img"
        aria-label={`Time-series chart for ${series.title}`}
      >
        <defs>
          <linearGradient id={`grad-${series.key}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8fbf9a" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#8fbf9a" stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <line
          x1={padL}
          y1={padT}
          x2={w - padR}
          y2={padT}
          stroke="rgba(243,238,228,0.08)"
          strokeDasharray="3 3"
        />
        <line
          x1={padL}
          y1={padT + plotH / 2}
          x2={w - padR}
          y2={padT + plotH / 2}
          stroke="rgba(243,238,228,0.08)"
          strokeDasharray="3 3"
        />
        <line
          x1={padL}
          y1={padT + plotH}
          x2={w - padR}
          y2={padT + plotH}
          stroke="rgba(243,238,228,0.14)"
        />
        <path d={areaPath} fill={`url(#grad-${series.key})`} />
        <path d={linePath} fill="none" stroke="#8fbf9a" strokeWidth={2} />
        {coords.map((c, idx) =>
          idx === 0 || idx === coords.length - 1 || idx % 4 === 0 ? (
            <circle key={c.date} cx={c.x} cy={c.y} r={2.6} fill="#d4b483" />
          ) : null,
        )}
        <text x={padL} y={h - 5} fill="#9a9284" fontSize={9.5}>
          {first.date} (min {minV.toLocaleString(undefined, { maximumFractionDigits: 2 })})
        </text>
        <text x={w - padR} y={h - 5} textAnchor="end" fill="#9a9284" fontSize={9.5}>
          {last.date} (max {maxV.toLocaleString(undefined, { maximumFractionDigits: 2 })})
        </text>
      </svg>

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-[var(--line)] pt-2 text-[11px] text-[var(--muted)]">
        <span className="truncate">Supports: {series.nodeTitle}</span>
        {series.url ? (
          <a
            href={series.url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-[var(--copper)] hover:underline"
          >
            St. Louis Fed ↗
          </a>
        ) : null}
      </div>
    </article>
  );
}

export function SpineCoverageChart({ nodes }: { nodes: DigressionNode[] }) {
  if (nodes.length === 0) return null;
  const lanes: PolicyLane[] = [...SPINE_LANES, "digression"];
  const totalSupported = nodes.filter((n) => n.status === "supported").length;
  const supportPct = Math.round((totalSupported / Math.max(1, nodes.length)) * 100);

  return (
    <article className="report-chart-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
            Policy Spine & Evidence Coverage
          </p>
          <h3 className="mt-0.5 font-[family-name:var(--font-display)] text-base text-[var(--ink)]">
            Empirical Graduation by Argument Stage
          </h3>
        </div>
        <div className="text-right">
          <p className="font-mono text-lg font-semibold text-[var(--copper)]">
            {supportPct}%
          </p>
          <p className="font-mono text-[10px] text-[var(--muted)]">
            {totalSupported}/{nodes.length} nodes supported
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-2.5">
        {lanes.map((lane) => {
          const laneNodes = nodes.filter((n) => nodeLane(n.kind) === lane);
          const supported = laneNodes.filter((n) => n.status === "supported").length;
          const contested = laneNodes.filter((n) => n.status === "contested").length;
          const proposed = laneNodes.filter(
            (n) => n.status !== "supported" && n.status !== "contested",
          ).length;
          const total = Math.max(1, laneNodes.length);

          return (
            <div key={lane} className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="uppercase tracking-[0.1em] text-[var(--ink)]">
                  {lane === "digression" ? "06 · Digressions" : LANE_LABEL[lane]}
                </span>
                <span className="font-mono text-[10px] text-[var(--muted)]">
                  {supported} sup · {contested} cont · {proposed} prop
                </span>
              </div>
              <div className="flex h-2.5 w-full overflow-hidden bg-[var(--bg)]">
                {supported > 0 ? (
                  <div
                    style={{ width: `${(supported / total) * 100}%` }}
                    className="bg-[#8fbf9a]"
                    title={`${supported} supported`}
                  />
                ) : null}
                {contested > 0 ? (
                  <div
                    style={{ width: `${(contested / total) * 100}%` }}
                    className="bg-[#d4a08c]"
                    title={`${contested} contested`}
                  />
                ) : null}
                {proposed > 0 ? (
                  <div
                    style={{ width: `${(proposed / total) * 100}%` }}
                    className="bg-[#d4b483]/50"
                    title={`${proposed} proposed`}
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}

export function IncidenceTradeoffMatrix({
  nodes,
  onOpenNode,
}: {
  nodes: DigressionNode[];
  onOpenNode?: (id: string) => void;
}) {
  const keyNodes = nodes.filter(
    (n) =>
      n.status !== "pruned" &&
      (n.kind === "incidence" ||
        n.kind === "claim" ||
        n.kind === "mechanism" ||
        n.kind === "counterfactual"),
  );
  if (keyNodes.length === 0) return null;

  return (
    <section className="mt-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
        Distributional Incidence & Mechanism Matrix
      </p>
      <div className="mt-2.5 grid gap-3 md:grid-cols-2">
        {keyNodes.map((node) => (
          <div
            key={node.id}
            className="border border-[var(--line)] bg-[var(--paper)] p-3.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className={`kind-tag kind-${node.kind}`}>{node.kind}</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
                  {node.status} · {node.confidence}
                </span>
                {onOpenNode ? (
                  <button
                    type="button"
                    className="node-cite-pill is-interactive"
                    onClick={() => onOpenNode(node.id)}
                  >
                    ↗ {shortNodeKey(node.id)}
                  </button>
                ) : (
                  <span className="node-cite-pill">[{shortNodeKey(node.id)}]</span>
                )}
              </div>
            </div>
            <h4 className="mt-1.5 font-[family-name:var(--font-display)] text-base text-[var(--ink)]">
              {node.title}
            </h4>
            <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
              {node.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

export type BibliographyEntry = {
  index: number;
  kind: "MCP SPAN" | "CITATION" | "WEB LEAD";
  source: string;
  label: string;
  url?: string;
  spanId?: string;
  nodeTitles: string[];
};

export function collectBibliography(
  nodes: DigressionNode[],
  analyses: Record<string, NodeAnalysis>,
): BibliographyEntry[] {
  const byKey = new Map<string, Omit<BibliographyEntry, "index">>();

  const add = (
    key: string,
    item: Omit<BibliographyEntry, "index" | "nodeTitles">,
    nodeTitle: string,
  ) => {
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.nodeTitles.includes(nodeTitle)) {
        existing.nodeTitles.push(nodeTitle);
      }
      return;
    }
    byKey.set(key, { ...item, nodeTitles: [nodeTitle] });
  };

  for (const node of nodes) {
    for (const chip of node.provenance) {
      if (chip.spanId) {
        add(
          chip.spanId,
          {
            kind: "MCP SPAN",
            source: chip.source,
            label: chip.label,
            url: chip.url,
            spanId: chip.spanId,
          },
          node.title,
        );
      }
    }
  }

  for (const analysis of Object.values(analyses)) {
    for (const citation of analysis.citations) {
      const key = citation.url || citation.title;
      add(
        key,
        {
          kind: "CITATION",
          source: "literature / official",
          label: citation.title,
          url: citation.url,
          spanId: citation.note,
        },
        analysis.title,
      );
    }
  }

  for (const node of nodes) {
    for (const chip of node.provenance) {
      if (!chip.spanId) {
        const key = chip.url || chip.label;
        add(
          key,
          {
            kind: "WEB LEAD",
            source: chip.source,
            label: chip.label,
            url: chip.url,
          },
          node.title,
        );
      }
    }
  }

  return [...byKey.values()].map((entry, idx) => ({
    ...entry,
    index: idx + 1,
  }));
}

export function VerifiedBibliographyTable({
  nodes,
  analyses,
}: {
  nodes: DigressionNode[];
  analyses: Record<string, NodeAnalysis>;
}) {
  const entries = collectBibliography(nodes, analyses);
  if (entries.length === 0) return null;

  return (
    <section className="mt-6 border-t border-[var(--line)] pt-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
            Full Sourcing & Provenance Register
          </p>
          <h3 className="mt-0.5 font-[family-name:var(--font-display)] text-lg text-[var(--ink)]">
            Verified MCP Spans, Official Series & Literature ({entries.length})
          </h3>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto border border-[var(--line)]">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--line)] bg-[var(--paper)] text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
              <th className="px-3 py-2.5">#</th>
              <th className="px-3 py-2.5">Type</th>
              <th className="px-3 py-2.5">Source & Citation</th>
              <th className="px-3 py-2.5">Backed Nodes</th>
              <th className="px-3 py-2.5">Span Hash / Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {entries.map((entry) => (
              <tr key={`${entry.index}-${entry.label}`} className="bg-[var(--bg)]/40">
                <td className="px-3 py-2.5 font-mono text-[var(--copper)]">
                  [{entry.index}]
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={`px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${
                      entry.kind === "MCP SPAN"
                        ? "bg-[#8fbf9a]/15 text-[#8fbf9a]"
                        : "bg-[var(--paper-strong)] text-[var(--muted)]"
                    }`}
                  >
                    {entry.kind} · {entry.source}
                  </span>
                </td>
                <td className="px-3 py-2.5 font-medium text-[var(--ink)]">
                  {entry.url ? (
                    <a
                      href={entry.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--copper)] hover:underline"
                    >
                      {entry.label} ↗
                    </a>
                  ) : (
                    entry.label
                  )}
                </td>
                <td className="px-3 py-2.5 text-[var(--muted)]">
                  {entry.nodeTitles.join(", ")}
                </td>
                <td className="px-3 py-2.5 font-mono text-[10px] text-[var(--muted)]">
                  {entry.spanId ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
