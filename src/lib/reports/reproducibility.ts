import type { ExtractedSeries, BibliographyEntry } from "@/components/studio/ReportCharts";
import type { RunEconomicModel } from "@/lib/economics/engine";
import type { DigressionNode } from "@/schemas/digression";
import type { ScopeContract } from "@/schemas/scope-contract";

export const CURRENT_PROMPT_VERSION = "polinote-econometrics-v2.5";
export const CURRENT_CODE_VERSION =
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
  "local-v2";

export const PINNED_PYTHON_PACKAGES = [
  "numpy==1.26.4",
  "pandas==2.2.2",
  "scipy==1.13.1",
  "statsmodels==0.14.2",
  "linearmodels==6.0",
  "requests==2.32.3",
] as const;

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "polinote-run"
  );
}

function triggerBrowserDownload(
  filename: string,
  content: string,
  mimeType: string,
): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Builds the CSV bundle string from the run's exact specification and live series.
 * Refuses to generate when no econometric estimate or live series exists.
 */
export function buildCsvBundleContent(input: {
  title: string;
  seriesList: ExtractedSeries[];
  econModel: RunEconomicModel;
}): string {
  const est = input.econModel.headlineEstimate;
  if (!est || input.seriesList.length === 0) {
    throw new Error(
      "Cannot export CSV data bundle: no live econometric estimate exists on this run.",
    );
  }

  const lines: string[] = [
    "# PoliNote Reproducible Econometric Data & Provenance Bundle",
    `# Run Title: ${input.title.replace(/[\r\n]+/g, " ")}`,
    `# Exported At: ${new Date().toISOString()}`,
    `# Code Version: ${CURRENT_CODE_VERSION} | Prompt Version: ${CURRENT_PROMPT_VERSION}`,
    `# Pre-Registration Lock Hash: ${est.spec.preRegistration.lockHash} (locked at ${est.spec.preRegistration.lockedAt})`,
    `# Headline Method: ${est.methodLabel} (${est.honestyLabel})`,
    `# Specification Formula: ${est.spec.formula}`,
    `# Outcome Series: ${est.spec.outcomeSeriesId} | Transform: ${est.spec.transform} | Policy Date: ${est.spec.policyDate ?? "none"} | HAC Lags: ${est.spec.hacLags}`,
    `# Point Estimate: ${est.pointEstimate} | SE: ${est.standardError} | 95% CI: [${est.ciLower}, ${est.ciUpper}] | p-value: ${est.pValue} | N: ${est.sampleSize}`,
    "",
    "series_id,date,value,units,source,vintage_date,transform,seasonal_adjustment,snapshot_sha256,source_url",
  ];

  for (const s of input.seriesList) {
    const prov = s.provenance;
    const source = prov?.source ?? "fred";
    const vintage = prov?.vintageDate ?? s.vintage ?? "latest";
    const transform = (prov?.transform ?? est.spec.transform).replace(/,/g, ";");
    const sa = (prov?.seasonalAdjustment ?? "Reported").replace(/,/g, ";");
    const sha = prov?.payloadSha256 ?? s.resultHash ?? "";
    const url = prov?.url ?? s.url ?? "";
    const units = (s.units || "Units").replace(/,/g, ";");

    for (const pt of s.points) {
      lines.push(
        `${s.seriesId},${pt.date},${pt.value},"${units}",${source},${vintage},"${transform}","${sa}",${sha},${url}`,
      );
    }
  }

  return lines.join("\n");
}

export function downloadCsvBundle(input: {
  title: string;
  seriesList: ExtractedSeries[];
  econModel: RunEconomicModel;
}): void {
  const csv = buildCsvBundleContent(input);
  triggerBrowserDownload(
    `${slugify(input.title)}-data-bundle.csv`,
    csv,
    "text/csv;charset=utf-8",
  );
}

/**
 * Builds the runnable Jupyter Notebook (.ipynb) JSON object embedding the run's exact
 * specification, pre-registration lock, pinned library versions, and SHA-256 snapshot.
 * Refuses to generate when no econometric estimate exists (zero default series or dates).
 */
export function buildJupyterNotebookObject(input: {
  runId: string;
  title: string;
  scope: ScopeContract | null;
  seriesList: ExtractedSeries[];
  econModel: RunEconomicModel;
  nodes: DigressionNode[];
  bibliography: BibliographyEntry[];
}): Record<string, unknown> {
  const est = input.econModel.headlineEstimate;
  if (!est || input.seriesList.length === 0) {
    throw new Error(
      "Cannot export Jupyter Notebook: no live econometric estimate exists on this run.",
    );
  }

  const leadSeries =
    input.seriesList.find((s) => s.seriesId === est.spec.outcomeSeriesId) ??
    input.seriesList[0]!;
  const seriesId = est.spec.outcomeSeriesId;
  const policyDate = est.spec.policyDate;
  const windowStart = est.sampleWindow.start;
  const windowEnd = est.sampleWindow.end;
  const transform = est.spec.transform;
  const hacLags = est.spec.hacLags;
  const lpHorizons = est.spec.lpHorizons;
  const lockHash = est.spec.preRegistration.lockHash;
  const lockedAt = est.spec.preRegistration.lockedAt;
  const snapshotSha =
    est.provenance.payloadSha256 || leadSeries.resultHash || "";
  const embeddedSnapshot = leadSeries.points;

  const mdHeader = [
    `# PoliNote Reproducible Econometric Notebook: ${input.title}`,
    "",
    `- **Run ID:** \`${input.runId}\``,
    `- **Pre-Registration Lock Hash:** \`${lockHash}\` (Locked at \`${lockedAt}\` prior to observation fetch)`,
    `- **Snapshot SHA-256:** \`${snapshotSha}\``,
    `- **Code Version:** \`${CURRENT_CODE_VERSION}\` · **Prompt Version:** \`${CURRENT_PROMPT_VERSION}\``,
    `- **Pinned Python Dependencies:** \`${PINNED_PYTHON_PACKAGES.join(" ")}\``,
    `- **Primary Series:** \`${seriesId}\` (${windowStart} to ${windowEnd}, Transform: \`${transform}\`, HAC Lags: \`${hacLags}\`, Policy Date: \`${policyDate ?? "none"}\`)`,
    `- **Method & Honesty Label:** ${est.methodLabel} — **${est.honestyLabel}**`,
    ...(est.relabelReason ? [`- **Honesty Relabel Note:** ${est.relabelReason}`] : []),
    "",
    "### Scope Contract",
    `- **Question:** ${input.scope?.question ?? input.title}`,
    `- **Instrument:** ${input.scope?.instrument ?? "See run scope"}`,
    `- **Target:** ${input.scope?.target ?? seriesId}`,
    `- **Policy Date Source:** ${input.scope?.policyDateSource ?? "See scope contract"}`,
    `- **Identification Strategy:** ${input.scope?.identificationStrategy ?? est.methodLabel}`,
  ].join("\n");

  const pyCodeSetup = [
    `# Pinned environment: pip install ${PINNED_PYTHON_PACKAGES.join(" ")}`,
    "import os",
    "import hashlib",
    "import json",
    "import requests",
    "import numpy as np",
    "import pandas as pd",
    "import statsmodels.api as sm",
    "from statsmodels.stats.diagnostic import acorr_ljungbox, het_breuschpagan",
    "",
    `SERIES_ID = ${JSON.stringify(seriesId)}`,
    `WINDOW_START = ${JSON.stringify(windowStart)}`,
    `WINDOW_END = ${JSON.stringify(windowEnd)}`,
    `POLICY_DATE = ${JSON.stringify(policyDate)}`,
    `TRANSFORM = ${JSON.stringify(transform)}`,
    `HAC_LAGS = ${hacLags}`,
    `LP_HORIZONS = ${lpHorizons}`,
    `PRE_REGISTRATION_HASH = ${JSON.stringify(lockHash)}`,
    `PRE_REGISTRATION_LOCKED_AT = ${JSON.stringify(lockedAt)}`,
    `RUN_SNAPSHOT_SHA256 = ${JSON.stringify(snapshotSha)}`,
    "",
    "# Embedded run-time snapshot for audit & revision diffing (never used as a silent fallback)",
    `SNAPSHOT_OBSERVATIONS = json.loads(${JSON.stringify(JSON.stringify(embeddedSnapshot))})`,
    "df_snapshot = pd.DataFrame(SNAPSHOT_OBSERVATIONS)",
    "print(f'Loaded embedded snapshot: {len(df_snapshot)} observations (sha256={RUN_SNAPSHOT_SHA256[:16]}...)')",
  ].join("\n");

  const pyCodeLivePull = [
    "# Live re-pull from FRED API and revision diff against the run snapshot",
    "FRED_API_KEY = os.environ.get('FRED_API_KEY', '').strip()",
    "if not FRED_API_KEY:",
    "    raise RuntimeError('Data unavailable: FRED_API_KEY environment variable is required for live reproduction.')",
    "",
    "url = (",
    "    f'https://api.stlouisfed.org/fred/series/observations'",
    "    f'?series_id={SERIES_ID}&observation_start={WINDOW_START}&observation_end={WINDOW_END}'",
    "    f'&file_type=json&sort_order=asc&api_key={FRED_API_KEY}'",
    ")",
    "resp = requests.get(url, timeout=15)",
    "resp.raise_for_status()",
    "live_sha256 = hashlib.sha256(resp.text.encode('utf-8')).hexdigest()",
    "raw_obs = resp.json().get('observations', [])",
    "df_live = pd.DataFrame([",
    "    {'date': r['date'], 'value': float(r['value'])}",
    "    for r in raw_obs if r.get('value') not in (None, '.')",
    "])",
    "",
    "print(f'Live pull complete: {len(df_live)} observations (live_sha256={live_sha256[:16]}...)')",
    "if not df_snapshot.empty:",
    "    merged = pd.merge(df_snapshot, df_live, on='date', how='outer', suffixes=('_snapshot', '_live'))",
    "    merged['revision_diff'] = merged['value_live'] - merged['value_snapshot']",
    "    revisions = merged[merged['revision_diff'].abs() > 1e-6]",
    "    print(f'Vintage Revision Check: {len(revisions)} observation(s) revised since run snapshot.')",
    "    if len(revisions) > 0:",
    "        display(revisions.head(10))",
  ].join("\n");

  const pyCodeEstimate = [
    "# Reproduce Headline Specification with Newey-West HAC SEs",
    "df = df_live.copy()",
    "df['date_dt'] = pd.to_datetime(df['date'])",
    "df = df.sort_values('date_dt').reset_index(drop=True)",
    "if TRANSFORM == 'log':",
    "    df = df[df['value'] > 0].copy()",
    "    df['value'] = np.log(df['value'])",
    "elif TRANSFORM == 'diff':",
    "    df['value'] = df['value'].pct_change() * 100.0",
    "    df = df.dropna().reset_index(drop=True)",
    "",
    "if not POLICY_DATE:",
    "    raise RuntimeError('Policy date is required for pre/post estimation.')",
    "split_idx = df[df['date'] >= POLICY_DATE].index.min()",
    "if pd.isna(split_idx):",
    "    raise RuntimeError(f'Policy date {POLICY_DATE} is outside series window.')",
    "",
    "df['post'] = (df.index >= split_idx).astype(float)",
    "df['trend'] = np.arange(len(df), dtype=float) - float(split_idx)",
    "df['post_trend'] = df['post'] * df['trend']",
    "",
    "X = sm.add_constant(df[['post', 'trend', 'post_trend']])",
    "model = sm.OLS(df['value'], X).fit(cov_type='HAC', cov_kwds={'maxlags': HAC_LAGS})",
    "print(model.summary())",
    "",
    "# Jordà Local Projections (h = 0..LP_HORIZONS)",
    "lp_rows = []",
    "for h in range(0, min(LP_HORIZONS + 1, len(df) // 3)):",
    "    yh = df['value'].shift(-h) - df['value'].shift(1)",
    "    lag_dy = df['value'].diff(1).shift(1)",
    "    valid = pd.concat([yh.rename('yh'), df['post'], lag_dy.rename('lag_dy')], axis=1).dropna()",
    "    X_lp = sm.add_constant(valid[['post', 'lag_dy']])",
    "    fit_lp = sm.OLS(valid['yh'], X_lp).fit(cov_type='HAC', cov_kwds={'maxlags': h + 1})",
    "    ci_low, ci_high = fit_lp.conf_int().loc['post']",
    "    lp_rows.append({'horizon': f'h={h}', 'beta': fit_lp.params['post'], 'se': fit_lp.bse['post'], 'ci_low': ci_low, 'ci_high': ci_high, 'p_value': fit_lp.pvalues['post']})",
    "df_lp = pd.DataFrame(lp_rows)",
    "display(df_lp)",
  ].join("\n");

  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: {
        display_name: "Python 3",
        language: "python",
        name: "python3",
      },
      language_info: {
        name: "python",
        version: "3.11",
      },
      polinote: {
        runId: input.runId,
        preRegistrationHash: lockHash,
        preRegistrationLockedAt: lockedAt,
        snapshotSha256: snapshotSha,
        codeVersion: CURRENT_CODE_VERSION,
        promptVersion: CURRENT_PROMPT_VERSION,
        pinnedPackages: PINNED_PYTHON_PACKAGES,
      },
    },
    cells: [
      {
        cell_type: "markdown",
        metadata: {},
        source: mdHeader.split("\n").map((l) => `${l}\n`),
      },
      {
        cell_type: "code",
        execution_count: null,
        metadata: {},
        outputs: [],
        source: pyCodeSetup.split("\n").map((l) => `${l}\n`),
      },
      {
        cell_type: "code",
        execution_count: null,
        metadata: {},
        outputs: [],
        source: pyCodeLivePull.split("\n").map((l) => `${l}\n`),
      },
      {
        cell_type: "code",
        execution_count: null,
        metadata: {},
        outputs: [],
        source: pyCodeEstimate.split("\n").map((l) => `${l}\n`),
      },
    ],
  };
}

export function downloadJupyterNotebook(input: {
  runId: string;
  title: string;
  scope: ScopeContract | null;
  seriesList: ExtractedSeries[];
  econModel: RunEconomicModel;
  nodes: DigressionNode[];
  bibliography: BibliographyEntry[];
}): void {
  const notebook = buildJupyterNotebookObject(input);
  triggerBrowserDownload(
    `${slugify(input.title)}-reproduce.ipynb`,
    JSON.stringify(notebook, null, 2),
    "application/x-ipynb+json",
  );
}
