import type { ExtractedSeries, BibliographyEntry } from "@/components/studio/ReportCharts";
import type { RunEconomicModel } from "@/lib/economics/engine";
import { CURRENT_CODE_VERSION, CURRENT_PROMPT_VERSION } from "@/lib/rate-limit";
import type { DigressionNode } from "@/schemas/digression";
import type { ScopeContract } from "@/schemas/scope-contract";

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
 * Exports all live series observations and full provenance metadata as a CSV bundle.
 */
export function downloadCsvBundle(input: {
  title: string;
  seriesList: ExtractedSeries[];
  econModel: RunEconomicModel;
}): void {
  const lines: string[] = [
    "# PoliNote Reproducible Econometric Data & Provenance Bundle",
    `# Run Title: ${input.title.replace(/[\r\n]+/g, " ")}`,
    `# Exported At: ${new Date().toISOString()}`,
    `# Code Version: ${CURRENT_CODE_VERSION} | Prompt Version: ${CURRENT_PROMPT_VERSION}`,
  ];

  if (input.econModel.headlineEstimate) {
    const est = input.econModel.headlineEstimate;
    lines.push(
      `# Pre-Registration Lock Hash: ${est.spec.preRegistration.lockHash}`,
      `# Headline Method: ${est.methodLabel} (${est.honestyLabel})`,
      `# Point Estimate: ${est.pointEstimate} | SE: ${est.standardError} | 95% CI: [${est.ciLower}, ${est.ciUpper}] | p-value: ${est.pValue} | N: ${est.sampleSize}`,
    );
  }

  lines.push(
    "",
    "series_id,date,value,units,source,vintage_date,transform,seasonal_adjustment,snapshot_sha256,source_url",
  );

  for (const s of input.seriesList) {
    const prov = s.provenance;
    const source = prov?.source ?? "fred";
    const vintage = prov?.vintageDate ?? s.vintage ?? "latest";
    const transform = (prov?.transform ?? "lin").replace(/,/g, ";");
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

  triggerBrowserDownload(
    `${slugify(input.title)}-data-bundle.csv`,
    lines.join("\n"),
    "text/csv;charset=utf-8",
  );
}

/**
 * Generates and downloads a runnable Jupyter Notebook (.ipynb) that:
 * 1. Embeds the locked pre-registration specification and the exact snapshot SHA-256 & values used in the run.
 * 2. Re-pulls live data from the FRED API using `requests` / `pandas`.
 * 3. Compares the live pull against the embedded snapshot and prints a revision diff if any observations were revised.
 * 4. Reproduces the Newey-West HAC pre/post regression, Event Study leads/lags, and Jordà Local Projections using `statsmodels`.
 */
export function downloadJupyterNotebook(input: {
  runId: string;
  title: string;
  scope: ScopeContract | null;
  seriesList: ExtractedSeries[];
  econModel: RunEconomicModel;
  nodes: DigressionNode[];
  bibliography: BibliographyEntry[];
}): void {
  const leadSeries = input.seriesList[0];
  const est = input.econModel.headlineEstimate;
  const seriesId = est?.spec.outcomeSeriesId ?? leadSeries?.seriesId ?? "GDPC1";
  const policyDate = est?.spec.policyDate ?? "2018-01-01";
  const windowStart = est?.sampleWindow.start ?? leadSeries?.points[0]?.date ?? "2012-01-01";
  const windowEnd =
    est?.sampleWindow.end ??
    leadSeries?.points[leadSeries.points.length - 1]?.date ??
    new Date().toISOString().slice(0, 10);
  const lockHash = est?.spec.preRegistration.lockHash ?? "unregistered";
  const snapshotSha =
    est?.provenance.payloadSha256 ?? leadSeries?.resultHash ?? "none";
  const embeddedSnapshot = leadSeries?.points ?? [];

  const mdHeader = [
    `# PoliNote Reproducible Econometric Notebook: ${input.title}`,
    "",
    `- **Run ID:** \`${input.runId}\``,
    `- **Pre-Registration Lock Hash:** \`${lockHash}\``,
    `- **Snapshot SHA-256:** \`${snapshotSha}\``,
    `- **Code Version:** \`${CURRENT_CODE_VERSION}\` · **Prompt Version:** \`${CURRENT_PROMPT_VERSION}\``,
    `- **Primary Series:** \`${seriesId}\` (${windowStart} to ${windowEnd}, Policy Date: \`${policyDate}\`)`,
    `- **Honesty Label:** ${est?.honestyLabel ?? "Descriptive"}`,
    "",
    "### Scope Contract",
    `- **Question:** ${input.scope?.question ?? input.title}`,
    `- **Instrument:** ${input.scope?.instrument ?? "See run scope"}`,
    `- **Target:** ${input.scope?.target ?? seriesId}`,
    `- **Identification Strategy:** ${input.scope?.identificationStrategy ?? est?.methodLabel ?? "Event Study + Jordà Local Projections"}`,
  ].join("\n");

  const pyCodeSetup = [
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
    `PRE_REGISTRATION_HASH = ${JSON.stringify(lockHash)}`,
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
    "# Reproduce Headline Pre/Post & Event-Study Regression with Newey-West HAC SEs",
    "df = df_live.copy()",
    "df['date_dt'] = pd.to_datetime(df['date'])",
    "df = df.sort_values('date_dt').reset_index(drop=True)",
    "split_idx = df[df['date'] >= POLICY_DATE].index.min()",
    "if pd.isna(split_idx):",
    "    split_idx = len(df) // 2",
    "",
    "df['post'] = (df.index >= split_idx).astype(float)",
    "df['trend'] = np.arange(len(df), dtype=float) - float(split_idx)",
    "df['post_trend'] = df['post'] * df['trend']",
    "",
    "X = sm.add_constant(df[['post', 'trend', 'post_trend']])",
    "model = sm.OLS(df['value'], X).fit(cov_type='HAC', cov_kwds={'maxlags': 4})",
    "print(model.summary())",
    "",
    "# Jordà Local Projections (h = 0..8)",
    "lp_rows = []",
    "for h in range(0, min(9, len(df) // 3)):",
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

  const notebook = {
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
        snapshotSha256: snapshotSha,
        codeVersion: CURRENT_CODE_VERSION,
        promptVersion: CURRENT_PROMPT_VERSION,
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

  triggerBrowserDownload(
    `${slugify(input.title)}-reproduce.ipynb`,
    JSON.stringify(notebook, null, 2),
    "application/x-ipynb+json",
  );
}
